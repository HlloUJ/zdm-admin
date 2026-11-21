import { describe, expect, it } from 'vitest';
import { categoryTree, centerPrice } from './storeSelectionCenter';
describe('selection catalog view helpers', () => {
  it('builds independent type trees from one through four levels', () => {
    const tree = categoryTree(
      [1, 2, 3, 4].map((id) => ({ id, parentId: id === 1 ? null : id - 1, type: 'finished', name: `分类${id}` })),
      'finished',
    );
    expect(tree[0].children[0].children[0].children[0]).toMatchObject({ id: 4, key: 'finished:4', children: [] });
    expect(categoryTree([{ id: 1, parentId: null, type: 'accessory', name: '配件' }], 'finished')).toEqual([]);
  });
  it('distinguishes missing prices from real zero and renders a range once', () => {
    expect(centerPrice({ priceMin: 0, priceMax: 0 })).toBe('0');
    expect(centerPrice({ priceMin: null, priceMax: null })).toBe('—');
    expect(centerPrice({ priceMin: 12, priceMax: 24 })).toBe('12 – 24');
  });
});
