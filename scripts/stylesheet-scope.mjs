import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Only a stylesheet consumed as styles can avoid business-keyword classification.
// Raw/module-data imports, missing consumers and unresolvable imports stay unknown.
export function stylesheetScope(root, file) {
  const unknown = (reason) => ({ proven: false, reason, consumers: [] });
  try {
    if (!root || !existsSync(path.join(root, file))) return unknown('Stylesheet source unavailable');
    const sources = new Map();
    const walk = (dir) => {
      for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const name = dir + '/' + e.name;
        if (e.isSymbolicLink()) throw Error('Unproven source link');
        if (e.isDirectory()) walk(name);
        else if (!/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name) && /\.(?:vue|[cm]?[jt]sx?|css|scss|less)$/.test(name)) {
          const s = lstatSync(path.join(root, name));
          if (!s.isFile()) throw Error('Unknown source type');
          sources.set(name, readFileSync(path.join(root, name), 'utf8'));
        }
      }
    };
    walk('src');
    const edges = new Map(),
      leaves = new Map(),
      unsafe = new Set();
    const resolve = (owner, value) => {
      const raw = value.split(/[?#]/, 1)[0];
      return raw.startsWith('@/')
        ? 'src/' + raw.slice(2)
        : raw.startsWith('.')
          ? path.posix.normalize(path.posix.join(path.posix.dirname(owner), raw))
          : null;
    };
    const edge = (target, owner, scoped) => {
      if (!target) return;
      if (!edges.has(target)) edges.set(target, []);
      edges.get(target).push(owner);
      if (scoped !== undefined) {
        if (!leaves.has(target)) leaves.set(target, []);
        leaves.get(target).push({ file: owner, scoped });
      }
    };
    const cssImports = (owner, css, scoped) => {
      for (const m of css.matchAll(/@(?:import|use|forward)\s+(?:url\(\s*)?['"]([^'"]+)['"]/g)) {
        const target = resolve(owner, m[1]);
        if (!target || !sources.has(target)) {
          unsafe.add(owner);
          continue;
        }
        edge(target, owner, scoped);
      }
      if (/:global\b|@font-face\b|@property\b/.test(css)) unsafe.add(owner);
    };
    for (const [owner, source] of sources) {
      if (/\.(?:css|scss|less)$/.test(owner)) {
        cssImports(owner, source);
        continue;
      }
      let script = source;
      if (owner.endsWith('.vue')) {
        for (const style of source.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/g)) {
          const scoped = /\bscoped\b/.test(style[1]);
          const ref = style[1].match(/\bsrc=['"]([^'"]+)['"]/);
          if (ref) {
            const target = resolve(owner, ref[1]);
            if (!target) unsafe.add(owner);
            else edge(target, owner, scoped);
          }
          cssImports(owner, style[2], scoped);
        }
        script = source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');
      }
      for (const match of script.matchAll(
        /\bimport\s+(?:(.*?)\s+from\s*)?['"]([^'"]+\.(?:css|scss|less)(?:\?[^'"]*)?)['"]/g,
      )) {
        const target = resolve(owner, match[2]);
        if (target) {
          if (match[1] || match[2].includes('?')) unsafe.add(target);
          edge(target, owner, false);
        }
      }
      for (const match of script.matchAll(
        /(?:\brequire\s*\(|\bexport\s+[^;]*?\bfrom\s*)['"]([^'"]+\.(?:css|scss|less)(?:\?[^'"]*)?)['"]/g,
      )) {
        const target = resolve(owner, match[1]);
        if (target) unsafe.add(target);
      }
      for (const match of script.matchAll(/\bimport\s*\(\s*['"]([^'"]+\.(?:css|scss|less)(?:\?[^'"]*)?)['"]\s*\)/g)) {
        const target = resolve(owner, match[1]);
        if (target) unsafe.add(target);
      }
    }
    const consumers = [],
      seen = new Set();
    let unproven = false;
    const visit = (current) => {
      if (seen.has(current)) return;
      seen.add(current);
      if (unsafe.has(current)) unproven = true;
      for (const leaf of leaves.get(current) ?? []) consumers.push(leaf);
      for (const consumer of edges.get(current) ?? []) {
        if (/\.(?:css|scss|less)$/.test(consumer)) visit(consumer);
        else if (!(leaves.get(current) ?? []).some((l) => l.file === consumer))
          consumers.push({ file: consumer, scoped: false });
      }
    };
    visit(file);
    const distinct = [...new Map(consumers.map((c) => [c.file + ':' + c.scoped, c])).values()].sort((a, b) =>
      a.file < b.file ? -1 : a.file > b.file ? 1 : 0,
    );
    if (unproven)
      return { ...unknown('Stylesheet consumer nature or transitive import is unproven'), consumers: distinct };
    if (!distinct.length) return unknown('No complete stylesheet consumer binding');
    return {
      proven: true,
      nature: 'styles-only',
      shared: distinct.length > 1 || distinct.some((c) => !c.scoped),
      reason: distinct.some((c) => !c.scoped)
        ? 'Unscoped/global stylesheet consumer'
        : distinct.length > 1
          ? 'Multiple scoped consumers'
          : 'One verified scoped style consumer',
      consumers: distinct,
    };
  } catch (error) {
    return unknown('Stylesheet scope unavailable: ' + error.message);
  }
}
