"""Delete only a sealed inventory through directory descriptors; no path recursion."""
import json
import os
import stat
import sys


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def record(s):
    return [str(s.st_dev), str(s.st_ino), s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_mode]


def open_root(absolute):
    require(os.path.isabs(absolute) and os.path.normpath(absolute) == absolute, 'Noncanonical deletion path')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in absolute.split('/')[1:]:
            require(part not in ('', '.', '..'), 'Unsafe path segment')
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def main():
    request = json.load(sys.stdin)
    inventory = request['entries']
    expected = {e['path']: e for e in inventory}
    require(len(expected) == len(inventory) and '' in expected, 'Invalid sealed inventory')
    for name in expected:
        require(name == '' or (not os.path.isabs(name) and all(p not in ('', '.', '..') for p in name.split('/'))), 'Unsafe inventory path')
    root = open_root(request['path'])
    deleted_bytes = 0
    deleted_files = 0

    def validate(fd, relative):
        own = expected[relative]
        s = os.fstat(fd)
        require(stat.S_ISDIR(s.st_mode) and [str(s.st_dev), str(s.st_ino), s.st_mode] == [own['dev'], own['ino'], own['mode']], 'Directory identity changed')
        for name in os.listdir(fd):
            key = relative + '/' + name if relative else name
            require(key in expected, 'Unregistered content appeared: ' + key)
            entry = expected[key]
            current = os.stat(name, dir_fd=fd, follow_symlinks=False)
            require(not stat.S_ISLNK(current.st_mode), 'Linked deletion member refused')
            if entry['kind'] == 'directory':
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try:
                    validate(child, key)
                finally:
                    os.close(child)
            else:
                require(stat.S_ISREG(current.st_mode) and current.st_nlink == 1, 'Nonprivate deletion member')
                require(record(current) == [entry['dev'], entry['ino'], entry['size'], int(entry['mtimeNs']), int(entry['ctimeNs']), entry['mode']], 'File identity changed: ' + key)

    def remove(fd, relative):
        nonlocal deleted_bytes, deleted_files
        for name in os.listdir(fd):
            key = relative + '/' + name if relative else name
            require(key in expected, 'New unregistered content during deletion: ' + key)
            entry = expected[key]
            current = os.stat(name, dir_fd=fd, follow_symlinks=False)
            if entry['kind'] == 'directory':
                require(stat.S_ISDIR(current.st_mode), 'Directory replaced during deletion')
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try:
                    require(str(os.fstat(child).st_ino) == entry['ino'] and str(os.fstat(child).st_dev) == entry['dev'], 'Child directory identity changed')
                    remove(child, key)
                    again = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    require(again.st_ino == os.fstat(child).st_ino and again.st_dev == os.fstat(child).st_dev, 'Directory renamed during deletion')
                    os.rmdir(name, dir_fd=fd)
                finally:
                    os.close(child)
            else:
                require(stat.S_ISREG(current.st_mode) and current.st_nlink == 1, 'Linked/special deletion member')
                require(record(current) == [entry['dev'], entry['ino'], entry['size'], int(entry['mtimeNs']), int(entry['ctimeNs']), entry['mode']], 'File changed during deletion')
                os.unlink(name, dir_fd=fd)
                deleted_bytes += current.st_size
                deleted_files += 1

    try:
        validate(root, '')
        remove(root, '')
        # Resolve the parent independently without following links; prove it still names this exact root.
        parent = open_root(os.path.dirname(request['path']))
        try:
            leaf = os.path.basename(request['path'])
            s = os.stat(leaf, dir_fd=parent, follow_symlinks=False)
            require(s.st_ino == os.fstat(root).st_ino and s.st_dev == os.fstat(root).st_dev, 'Deletion parent changed')
            os.rmdir(leaf, dir_fd=parent)
        finally:
            os.close(parent)
    finally:
        os.close(root)
    print(json.dumps({'deletedLogicalBytes': deleted_bytes, 'deletedFiles': deleted_files, 'physicalBytes': None}))


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
