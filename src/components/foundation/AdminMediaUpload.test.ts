import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import AdminMediaUpload from './AdminMediaUpload.vue';
import { adminFeedback } from './feedback/adminFeedback';
vi.mock('./feedback/adminFeedback', () => ({ adminFeedback: { actionSuccess: vi.fn(), actionError: vi.fn() } }));
const NativeUpload = defineComponent({
  name: 'TUpload',
  props: [
    'files',
    'theme',
    'max',
    'multiple',
    'requestMethod',
    'imageViewerProps',
    'showImageFileName',
    'trigger',
    'disabled',
  ],
  render: () => h('div'),
});
const media = { name: 'test.png', mediaId: 42, url: '/test.png' };
function setup(props = {}) {
  return mount(AdminMediaUpload, {
    props: { title: '封面图', accept: 'image/*', upload: vi.fn().mockResolvedValue(media), ...props },
    global: { stubs: { 't-upload': NativeUpload } },
  });
}
describe('shared native media upload adapter', () => {
  it('uses native image cards without another viewer or duplicate filename captions', () => {
    const upload = setup().findComponent(NativeUpload);
    expect(upload.props()).toMatchObject({
      theme: 'image',
      max: 1,
      multiple: false,
      showImageFileName: false,
      imageViewerProps: { visible: false },
    });
  });
  it('uses the existing upload result and releases an old value only after success', async () => {
    const previous = { ...media, mediaId: 1 };
    const wrapper = setup({ modelValue: previous });
    const upload = wrapper.findComponent(NativeUpload);
    const response = await upload.props('requestMethod')({ raw: new File(['x'], 'test.png') });
    expect(wrapper.emitted('removed')).toBeUndefined();
    upload.vm.$emit('success', { response: response.response });
    expect(wrapper.emitted('update:modelValue')).toEqual([[media]]);
    expect(wrapper.emitted('removed')).toEqual([[previous]]);
  });
  it('keeps the previous media and release events untouched when upload fails', async () => {
    const wrapper = setup({ modelValue: media, upload: vi.fn().mockRejectedValue(new Error('上传失败')) });
    const response = await wrapper.findComponent(NativeUpload).props('requestMethod')({
      raw: new File(['x'], 'bad.png'),
    });
    expect(response.status).toBe('fail');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('removed')).toBeUndefined();
    expect(adminFeedback.actionError).toHaveBeenCalled();
  });
  it('returns an empty failed upload to the native selection state for retry', async () => {
    const wrapper = setup();
    const upload = wrapper.findComponent(NativeUpload);
    upload.vm.$emit('change', [{ name: 'failed.png', status: 'fail' }]);
    await nextTick();
    upload.vm.$emit('fail');
    await nextTick();
    expect(wrapper.findComponent(NativeUpload).props('files')).toEqual([]);
    expect(wrapper.emitted('removed')).toBeUndefined();
  });
  it('uses the native image card for video and retains preview and explicit removal', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const wrapper = setup({ modelValue: media, mediaType: 'video', title: '商品视频' });
    const upload = wrapper.findComponent(NativeUpload);
    expect(upload.props('theme')).toBe('image');
    expect(upload.props('files')[0].url).toBe('');
    await upload.trigger('click');
    expect(wrapper.emitted('preview')).toEqual([[media]]);
    upload.vm.$emit('remove');
    expect(wrapper.emitted('removed')).toEqual([[media]]);
    expect(wrapper.emitted('update:modelValue')).toEqual([[undefined]]);
    wrapper.unmount();
    vi.restoreAllMocks();
  });
  it('uses a local first frame only for display and cleans up the video reader', async () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,frame');
    const wrapper = setup({ modelValue: media, mediaType: 'video' });
    const video = load.mock.contexts[0] as HTMLVideoElement;
    video.dispatchEvent(new Event('loadeddata'));
    await nextTick();
    expect(wrapper.findComponent(NativeUpload).props('files')[0].url).toBe('data:image/jpeg;base64,frame');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(drawImage).toHaveBeenCalled();
    expect(video.hasAttribute('src')).toBe(false);
    expect(video.onloadeddata).toBeNull();
    wrapper.unmount();
    vi.restoreAllMocks();
  });
  it('reuses the existing slab cover without extracting or changing the video resource', async () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const slabVideo = {
      name: 'slab.mp4',
      videoMediaId: 8,
      videoUrl: '/slab.mp4',
      coverMediaId: 9,
      coverUrl: '/cover.jpg',
    };
    const wrapper = setup({ modelValue: slabVideo, mediaType: 'video' });
    const upload = wrapper.findComponent(NativeUpload);
    expect(upload.props('files')[0].url).toBe('/cover.jpg');
    expect(load).not.toHaveBeenCalled();
    await upload.trigger('click');
    expect(wrapper.emitted('preview')).toEqual([[slabVideo]]);
    wrapper.unmount();
    vi.restoreAllMocks();
  });
  it('preserves read-only preview while blocking removal', async () => {
    const wrapper = setup({ modelValue: media, disabled: true });
    const upload = wrapper.findComponent(NativeUpload);
    expect(upload.props('disabled')).toBe(true);
    await upload.trigger('click');
    expect(wrapper.emitted('preview')).toEqual([[media]]);
    upload.vm.$emit('remove');
    expect(wrapper.emitted('removed')).toBeUndefined();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
  it('preserves keyboard preview without swallowing Enter on an empty native upload', async () => {
    const wrapper = setup();
    const empty = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    wrapper.findComponent(NativeUpload).element.dispatchEvent(empty);
    expect(empty.defaultPrevented).toBe(false);
    await wrapper.setProps({ modelValue: media });
    await wrapper.findComponent(NativeUpload).trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('preview')).toEqual([[media]]);
  });
});
