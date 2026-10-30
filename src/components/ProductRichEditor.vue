<template>
  <section class="product-rich-editor" data-testid="product-rich-editor">
    <div ref="toolbarElement" class="product-rich-editor__toolbar" />
    <div ref="editorElement" class="product-rich-editor__content" />
  </section>
</template>

<script setup lang="ts">
import '@wangeditor/editor/dist/css/style.css';
import {
  createEditor,
  createToolbar,
  DomEditor,
  SlateEditor,
  SlateElement,
  SlateNode,
  SlateText,
  SlateTransforms,
  type IDomEditor,
  type SlateDescendant,
} from '@wangeditor/editor';
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
let lastEmittedValue: string | undefined;

// Track only the empty paragraph at this upload's insertion point.
// Earlier blank paragraphs, including manually entered newlines, remain untouched.
let automaticLanding: ReturnType<typeof SlateEditor.pathRef> | undefined;
const clearAutomaticLanding = () => {
  automaticLanding?.unref();
  automaticLanding = undefined;
};
const isEmptyParagraph = (node: SlateNode | undefined) =>
  node &&
  SlateElement.isElement(node) &&
  DomEditor.getNodeType(node) === 'paragraph' &&
  node.children.every((child) => SlateText.isText(child) && child.text === '');

const positionAfterMedia = (media: SlateDescendant) => {
  // Native video insertion is queued; run after it has entered the Slate document.
  queueMicrotask(() => {
    const instance = editor;
    if (!instance) return;
    const entry = Array.from(
      SlateEditor.nodes(instance, {
        at: [],
        match: (node) =>
          SlateElement.isElement(node) &&
          DomEditor.getNodeType(node) === DomEditor.getNodeType(media) &&
          (node as { src?: string }).src === (media as { src?: string }).src,
        voids: true,
      }),
    )[0];
    if (!entry) return;
    let blockIndex = entry[1][0];
    if (SlateElement.isElement(media) && DomEditor.getNodeType(media) === 'video') {
      const previous = instance.children[blockIndex - 1];
      if (automaticLanding?.current?.[0] === blockIndex - 1 && isEmptyParagraph(previous)) {
        SlateTransforms.removeNodes(instance, { at: [blockIndex - 1] });
        blockIndex--;
      }
      const next = instance.children[blockIndex + 1];
      if (!isEmptyParagraph(next)) {
        SlateTransforms.insertNodes(instance, { type: 'paragraph', children: [{ text: '' }] } as SlateDescendant, {
          at: [blockIndex + 1],
        });
      }
      SlateTransforms.select(instance, SlateEditor.start(instance, [blockIndex + 1]));
    } else {
      const after = SlateEditor.after(instance, entry[1]);
      if (!after) return;
      SlateTransforms.select(instance, after);
      instance.insertBreak();
    }
    clearAutomaticLanding();

    // Focus restores wangEditor's cached selection; render the new paragraph first,
    // then put the caret back at its current Slate position.
    requestAnimationFrame(() => {
      if (editor !== instance || !instance.selection) return;
      const currentSelection = instance.selection;
      instance.focus();
      SlateTransforms.select(instance, currentSelection);
    });
  });
};

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
    if (editor && media.url) {
      clearAutomaticLanding();
      editor.restoreSelection();
      const path = editor.selection?.anchor.path;
      if (path && isEmptyParagraph(editor.children[path[0]])) {
        automaticLanding = SlateEditor.pathRef(editor, [path[0]], { affinity: 'backward' });
      }
      insert(media.url);
    } else props.release(media);
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
        if (value !== props.modelValue) {
          lastEmittedValue = value;
          emit('update:modelValue', value);
        }
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
        insertImage: { onInsertedImage: positionAfterMedia },
        insertVideo: { onInsertedVideo: positionAfterMedia },
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
    if (!editor || value === lastEmittedValue) return;
    lastEmittedValue = undefined;
    clearAutomaticLanding();
    const current = editor.isEmpty() ? '' : cleanHtml(editor.getHtml());
    if (current !== value) editor.setHtml(initialHtml(value));
  },
);

onBeforeUnmount(() => {
  clearAutomaticLanding();
  editor?.destroy();
  editor = undefined;
});
</script>

<style scoped>
.product-rich-editor {
  width: 100%;
  border: 1px solid var(--td-component-border);
}
.product-rich-editor__toolbar {
  border-bottom: 1px solid var(--td-component-border);
}
.product-rich-editor__content {
  height: 500px;
}
</style>
