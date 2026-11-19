"""Inspect and remove exact task-owned filesystem entries through directory descriptors."""
import errno
import json
import os
import runpy
import stat
import sys
import time

deletion = runpy.run_path(os.path.join(os.path.dirname(__file__), 'task-cleanup-delete.py'))
open_root = deletion['open_root']
require = deletion['require']

protected_names = {
    '.git', '.aws', '.ssh', 'backup', 'backups', 'media', 'uploads', 'volumes',
}


def protected(name):
    name = name.casefold()
    return (name in protected_names or name.startswith('.env') or
            name.endswith(('.sql', '.dump', '.bak', '.pem', '.key')))


def identity(s, directory=False):
    base = [str(s.st_dev), str(s.st_ino), s.st_mode]
    return base if directory else [*base, s.st_size, str(s.st_mtime_ns), str(s.st_ctime_ns), s.st_nlink]


def segments(relative):
    require(not os.path.isabs(relative), 'Absolute child path')
    parts = relative.split('/')
    require(all(p not in ('', '.', '..') for p in parts), 'Unsafe child path')
    return parts


def child_parent(root, relative, capture=False):
    parts = segments(relative)
    fd = os.dup(root)
    parents = []
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
            if capture:
                parents.append(identity(os.fstat(fd), directory=True))
        return fd, parts[-1], parents
    except BaseException:
        os.close(fd)
        raise


def inventory(fd, roots, limit, verified_repositories):
    entries = []
    blocked = []
    repositories = []
    dev = os.fstat(fd).st_dev

    def visit(parent, name, relative, parents, explicit):
        require(len(entries) + len(blocked) < limit, 'Inventory exceeds bounded entry count')
        s = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if s.st_dev != dev or (protected(name) and not explicit):
            blocked.append(relative)
            return
        is_dir = stat.S_ISDIR(s.st_mode)
        if not is_dir and not (stat.S_ISLNK(s.st_mode) or (stat.S_ISREG(s.st_mode) and s.st_nlink == 1)):
            blocked.append(relative)
            return
        proof = identity(s, is_dir)
        if is_dir:
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            try:
                require(proof == identity(os.fstat(child), True), 'Inventory directory changed')
                children = sorted(os.listdir(child), key=lambda p: (p == '.git', p))
                if '.git' in children and relative not in verified_repositories:
                    repositories.append(relative)
                    return
                for p in children:
                    visit(child, p, relative + '/' + p, [*parents, proof],
                          p == '.git' and relative in verified_repositories)
            finally:
                os.close(child)
        entries.append({'path': relative, 'parents': parents, 'identity': proof,
                        'directory': is_dir, 'bytes': 0 if is_dir else s.st_size})

    for name in roots if roots is not None else sorted(os.listdir(fd)):
        if any(protected(p) for p in segments(name)):
            blocked.append(name)
            continue
        parent, leaf, parents = child_parent(fd, name, True)
        try:
            try:
                visit(parent, leaf, name, parents, False)
            except FileNotFoundError:
                raise RuntimeError('Cleanup tree changed during discovery')
        finally:
            os.close(parent)
    return {'root': identity(os.fstat(fd), True), 'entries': entries, 'blocked': blocked, 'repositories': repositories}


def subtract(fd, request):
    require(identity(os.fstat(fd), True) == request['root'], 'Cleanup root was replaced')
    used = 0
    offset = 0
    skipped = []
    for item in request['entries']:
        if time.time_ns() // 1_000_000 >= request['deadline']:
            break
        try:
            parent, leaf, parents = child_parent(fd, item['path'], True)
        except FileNotFoundError:
            offset += 1
            continue
        try:
            require(parents == item['parents'], 'Cleanup ancestor was replaced: ' + item['path'])
            try:
                actual = os.stat(leaf, dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError:
                offset += 1
                continue
            require(identity(actual, item['directory']) == item['identity'], 'Cleanup member changed: ' + item['path'])
            if item['directory']:
                try:
                    os.rmdir(leaf, dir_fd=parent)
                except OSError as error:
                    if error.errno not in (errno.ENOTEMPTY, errno.EEXIST):
                        raise
                    skipped.append(item['path'])
            else:
                if used + actual.st_size > request['bytes']:
                    break
                os.unlink(leaf, dir_fd=parent)
                used += actual.st_size
            offset += 1
        finally:
            os.close(parent)
    return {'consumed': offset, 'deletedLogicalBytes': used, 'remainingDirectories': skipped}


def main():
    request = json.load(sys.stdin)
    # Paths to a linked ancestor are refused before any inventory or deletion.
    fd = open_root(request['path'])
    try:
        if request['action'] == 'inventory':
            result = inventory(fd, request.get('roots'), 250_000, request.get('repositories', []))
        elif request['action'] == 'subtract':
            result = subtract(fd, request)
        else:
            require(request['action'] == 'remove-empty-root', 'Unknown tree action')
            parent = open_root(os.path.dirname(request['path']))
            try:
                leaf = os.path.basename(request['path'])
                require(identity(os.fstat(fd), True) == request['root'], 'Cleanup root was replaced')
                require(identity(os.stat(leaf, dir_fd=parent, follow_symlinks=False), True) == request['root'],
                        'Cleanup root was renamed or replaced')
                os.rmdir(leaf, dir_fd=parent)
            finally:
                os.close(parent)
            result = {'removed': True}
    finally:
        os.close(fd)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        sys.exit(str(error))
