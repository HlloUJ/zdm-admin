"""Inspect a bounded npm archive. Never extract or follow archive links."""
import hashlib
import gzip
import io
import json
import sys
import tarfile


def inspect(data):
    if len(data) > 64 * 1024 * 1024:
        raise ValueError('Compressed dependency archive exceeds bound')
    files = {}
    install_scripts = []
    total = 0
    seen = set()
    # Bound the decompressed container before tarfile processes PAX headers or member sizes.
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as zipped:
        container = zipped.read(288 * 1024 * 1024 + 1)
    if len(container) > 288 * 1024 * 1024:
        raise ValueError('Dependency tar container exceeds bound')
    with tarfile.open(fileobj=io.BytesIO(container), mode='r:') as archive:
        for member in archive:
            if len(seen) >= 100000:
                raise ValueError('Dependency archive member bound exceeded')
            name = member.name.rstrip('/')
            parts = name.split('/')
            if parts[0] != 'package' or any(p in ('', '.', '..') for p in parts):
                raise ValueError('Noncanonical npm package member')
            if name in seen:
                raise ValueError('Duplicate dependency archive member')
            seen.add(name)
            if member.isdir():
                continue
            if not member.isfile() or member.linkname or member.size < 0:
                raise ValueError('Linked or special dependency archive member')
            if len(parts) < 2:
                raise ValueError('Package root is not a directory')
            if 'node_modules' in parts[1:] or member.mode & 0o7000:
                raise ValueError('Bundled/nested or special-mode dependency requires separate proof')
            total += member.size
            if total > 256 * 1024 * 1024:
                raise ValueError('Expanded dependency archive exceeds bound')
            stream = archive.extractfile(member)
            digest = hashlib.sha256()
            count = 0
            package_json = bytearray()
            if name == 'package/binding.gyp':
                raise ValueError('Implicit native installation requires separate proof')
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                count += len(chunk)
                digest.update(chunk)
                if name == 'package/package.json':
                    if count > 1024 * 1024:
                        raise ValueError('Dependency package manifest exceeds bound')
                    package_json.extend(chunk)
            if count != member.size:
                raise ValueError('Truncated dependency archive member')
            relative = '/'.join(parts[1:])
            files[relative] = {'sha256': digest.hexdigest(), 'bytes': count,
                               'executable': bool(member.mode & 0o111)}
            if name == 'package/package.json':
                scripts = json.loads(package_json).get('scripts', {})
                install_scripts = [key for key in ('preinstall', 'install', 'postinstall') if scripts.get(key)]
    if not files:
        raise ValueError('Empty dependency archive cannot prove package')
    if 'package.json' not in files:
        raise ValueError('Dependency package manifest is absent')
    return {'files': files, 'installScripts': install_scripts}


if __name__ == '__main__':
    try:
        data = sys.stdin.buffer.read(64 * 1024 * 1024 + 1)
        print(json.dumps(inspect(data), sort_keys=True))
    except BaseException as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
