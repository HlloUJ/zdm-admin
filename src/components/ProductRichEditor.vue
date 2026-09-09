<template>
  <section class="product-rich-editor" data-testid="product-rich-editor">
    <div ref="toolbarElement" class="product-rich-editor__toolbar" />
    <div ref="editorElement" class="product-rich-editor__content" />
  </section>
</template>

<script setup lang="ts">
import '@wangeditor/editor/dist/css/style.css';
import { createEditor, createToolbar, type IDomEditor } from '@wangeditor/editor';
import DOMPurify from 'dompurify';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { adminFeedback, type AdminMediaValue } from '@/components/foundation';

const props = defineProps<{
  modelValue: string;
  upload: (file: File, type: 'image' | 'video') => Promise<AdminMediaValue>;
  release: (media: AdminMediaValue) => void;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  uploading: [value: boolean];
}>();
const toolbarElement = ref<HTMLElement>();
const editorElement = ref<HTMLElement>();
let editor: IDomEditor | undefined;
let uploadingCount = 0;

const cleanHtml = (html: string) => {
  const clean = DOMPurify.sanitize(html, {
    ADD_TAGS: ['video'],
    ADD_ATTR: ['controls', 'data-w-e-type', 'data-w-e-is-void'],
  });
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  doc.querySelectorAll('video').forEach((video) => {
    const source = video.querySelector('source');
    if (!video.getAttribute('src') && source?.getAttribute('src'))
      video.setAttribute('src', source.getAttribute('src')!);
    video.querySelectorAll('source').forEach((item) => item.remove());
  });
  doc.querySelectorAll('img, video, source').forEach((media) => {
    if (!/^\/api\/open\/media\/[a-zA-Z0-9-]+$/.test(media.getAttribute('src') || '')) media.remove();
  });
  return doc.body.innerHTML;
};

const initialHtml = (value: string) => {
  if (!value) return '';
  if (/<[a-z][\s\S]*>/i.test(value)) return cleanHtml(value);
  const paragraph = document.createElement('p');
  paragraph.textContent = value;
  return paragraph.outerHTML;
};

const uploadMedia = async (file: File, type: 'image' | 'video', insert: (url: string) => void) => {
  uploadingCount++;
  emit('uploading', true);
  try {
    const media = await props.upload(file, type);
    if (editor && media.url) insert(media.url);
    else props.release(media);
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '媒体上传失败');
  } finally {
    uploadingCount--;
    emit('uploading', uploadingCount > 0);
  }
};

onMounted(() => {
  editor = createEditor({
    selector: editorElement.value!,
    html: initialHtml(props.modelValue),
    config: {
      placeholder: '',
      autoFocus: false,
      onChange(instance) {
        const value = instance.isEmpty() ? '' : cleanHtml(instance.getHtml());
        if (value !== props.modelValue) emit('update:modelValue', value);
      },
      customAlert(message) {
        adminFeedback.error(message);
      },
      customPaste(instance, event) {
        const html = event.clipboardData?.getData('text/html');
        if (!html) return true;
        event.preventDefault();
        instance.dangerouslyInsertHtml(cleanHtml(html));
        return false;
      },
      MENU_CONF: {
        uploadImage: {
          customUpload: (file: File, insert: (url: string, alt: string, href: string) => void) =>
            uploadMedia(file, 'image', (url) => insert(url, file.name, '')),
        },
        uploadVideo: {
          customUpload: (file: File, insert: (url: string, poster: string) => void) =>
            uploadMedia(file, 'video', (url) => insert(url, '')),
        },
        insertLink: {
          checkLink: (_text: string, url: string) =>
            /^(https?:\/\/|mailto:)/i.test(url) || '请输入有效的 http、https 或邮箱链接',
        },
        editLink: {
          checkLink: (_text: string, url: string) =>
            /^(https?:\/\/|mailto:)/i.test(url) || '请输入有效的 http、https 或邮箱链接',
        },
      },
    },
  });
  createToolbar({
    editor,
    selector: toolbarElement.value!,
    config: {
      toolbarKeys: [
        'headerSelect',
        'fontFamily',
        'fontSize',
        '|',
        'bold',
        'italic',
        'underline',
        'through',
        'clearStyle',
        'color',
        'bgColor',
        '|',
        'justifyLeft',
        'justifyCenter',
        'justifyRight',
        'justifyJustify',
        'lineHeight',
        '|',
        'bulletedList',
        'numberedList',
        'blockquote',
        'insertLink',
        'uploadImage',
        'uploadVideo',
        'insertTable',
        'divider',
        '|',
        'undo',
        'redo',
        'fullScreen',
      ],
    },
  });
});

watch(
  () => props.modelValue,
  (value) => {
    if (!editor) return;
    const current = editor.isEmpty() ? '' : cleanHtml(editor.getHtml());
    if (current !== value) editor.setHtml(initialHtml(value));
  },
);

onBeforeUnmount(() => {
  editor?.destroy();
  editor = undefined;
});
</script>

<style scoped>
.product-rich-editor {
  width: 100%;
  border: 1px solid #ccc;
}
.product-rich-editor__toolbar {
  border-bottom: 1px solid #ccc;
}
.product-rich-editor__content {
  height: 500px;
}
</style>
