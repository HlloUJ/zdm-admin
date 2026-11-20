"""Delete only a sealed inventory through directory descriptors; no path recursion."""
import json
import hashlib
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


SCOPE_ID = '683-original987-150-review-v1'
SCOPE_DIGEST = 'b6934241d973a2232275991324d457a58fcdab32a0690043b9722b7283a9993e'
SOURCE_TASK = 'delivery-standard-optimization'


def scope_bytes(filename):
    parent = open_root(os.path.dirname(filename))
    try:
        fd = os.open(os.path.basename(filename), os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
        try:
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o077,
                    'Unsafe deletion scope record')
            require(info.st_size <= 2 * 1024 ** 2, 'Oversized deletion scope record')
            with os.fdopen(os.dup(fd), 'rb') as stream:
                return stream.read(2 * 1024 ** 2 + 1)
        finally:
            os.close(fd)
    finally:
        os.close(parent)


def validate_scope(request):
    proof = request.get('scopeProof')
    require(isinstance(proof, dict), 'Exact deletion scope proof required')
    identity = {'version': 1, 'id': SCOPE_ID, 'sourceTask': SOURCE_TASK, 'manifestSetSha256': SCOPE_DIGEST}
    require(proof.get('identity') == identity, 'Wrong deletion scope identity')
    manifest_file = proof.get('manifestPath', '')
    # Bind all records to the same common directory and the original exact carrier.
    suffix = '/task-cleanup/staging/' + SOURCE_TASK + '/' + proof.get('key', '') + '/manifest.json'
    require(manifest_file.endswith(suffix), 'Wrong scoped manifest path')
    common = manifest_file[:-len(suffix)]
    require(proof.get('scopeFile') == common + '/task-cleanup/scopes/' + SCOPE_ID + '.json', 'Wrong scope file')
    require(proof.get('authorizationFile') == common + '/task-cleanup/scope-authorizations/' + SCOPE_ID + '.json', 'Wrong approval file')
    raw_scope = scope_bytes(proof['scopeFile'])
    raw_approval = scope_bytes(proof['authorizationFile'])
    require(hashlib.sha256(raw_scope).hexdigest() == proof.get('scopeDocumentSha256'), 'Scope changed before deletion')
    require(hashlib.sha256(raw_approval).hexdigest() == proof.get('authorizationSha256'), 'Approval changed before deletion')
    scope = json.loads(raw_scope)
    approval = json.loads(raw_approval)
    require(scope.get('scopeId') == SCOPE_ID and scope.get('sourceTask') == SOURCE_TASK and
            scope.get('physicalDeletionAuthorized') is False, 'Changed scope snapshot')
    require(approval.get('status') == 'approved' and approval.get('scopeId') == SCOPE_ID and
            approval.get('sourceTask') == SOURCE_TASK and approval.get('manifestSetSha256') == SCOPE_DIGEST and
            isinstance(approval.get('userMessageId'), str) and approval['userMessageId'], 'Physical scope not approved')
    members = scope.get('entries', [])
    require(len(members) == 150 and len({e['key'] for e in members}) == 150, 'Wrong scope member count')
    require([e['key'] for e in members] == sorted(e['key'] for e in members), 'Unordered scope')
    pairs = [{'key': e['key'], 'manifestSha256': e['manifestSha256']} for e in members]
    digest = hashlib.sha256(json.dumps(pairs, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    require(digest == SCOPE_DIGEST, 'Changed manifest set')
    selected = [e for e in members if e['key'] == proof['key']]
    require(len(selected) == 1 and selected[0]['sourceTask'] == SOURCE_TASK and
            selected[0]['manifestPath'] == manifest_file, 'Outside approved members')
    raw = scope_bytes(manifest_file)
    require(hashlib.sha256(raw).hexdigest() == selected[0]['manifestSha256'], 'Changed scoped manifest')
    manifest = json.loads(raw)
    require(manifest['task'] == SOURCE_TASK and manifest['producer'] == 'task-completion-handoff-v1' and
            manifest['disposition'] == selected[0]['disposition'], 'Wrong scoped source')
    require(request['path'] == manifest['carrier'] + '/deleting', 'Deletion path reused or substituted')
    return manifest['identity']['fingerprint']


def main():
    request = json.load(sys.stdin)
    fingerprint = validate_scope(request)
    inventory = request['entries']
    # Match the field order used by task-cleanup-queue.mjs when sealing the inventory.
    fields = ('path', 'kind', 'dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode')
    sealed = [{name: entry[name] for name in fields} for entry in inventory]
    encoded = json.dumps(sealed, ensure_ascii=False, separators=(',', ':')).encode()
    require(hashlib.sha256(encoded).hexdigest() == fingerprint, 'Inventory differs from approved manifest')
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
