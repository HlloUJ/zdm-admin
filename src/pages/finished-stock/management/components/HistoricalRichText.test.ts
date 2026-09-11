import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import HistoricalRichText from './HistoricalRichText.vue';
describe('historical rich text media', () => {
  it('keeps text order and opens image/video resources from small keyboard-accessible previews', async () => {
    const image = { available: true, mediaType: 'image', url: '/api/open/media/image' };
    const video = { available: true, mediaType: 'video', url: '/api/open/media/video' };
    const wrapper = mount(HistoricalRichText, {
      props: {
        html: '<p>前文</p><img src="/api/open/media/image" onerror="alert(1)"><p>中间</p><video src="/api/open/media/video" controls></video><script>alert(1)</script>',
        media: [{ resource: image }, { resource: video }],
      },
    });
    expect(wrapper.text()).toContain('前文');
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('img').attributes('onerror')).toBeUndefined();
    expect(wrapper.find('video').attributes('controls')).toBeUndefined();
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(2);
    await buttons[0].trigger('click');
    await buttons[1].trigger('click');
    expect(wrapper.emitted('preview')).toEqual([[image], [video]]);
  });
});
