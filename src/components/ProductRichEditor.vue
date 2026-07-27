<template>
  <section class="rich-editor-preview">
    <header class="editor-header">
      <div class="editor-title"><t-icon name="edit-1" /> 宝贝详情图文编辑器</div>
      <span class="editor-state"><t-icon name="edit" /> 可编辑</span>
    </header>

    <div class="toolbar toolbar-primary">
      <button class="select-tool" type="button">正文 <span>⌄</span></button>
      <button class="select-tool font-tool" type="button">系统字体 <span>⌄</span></button>
      <button class="select-tool size-tool" type="button">16 <span>⌄</span></button>
      <i />
      <button type="button"><strong>B</strong></button>
      <button type="button"><em>I</em></button>
      <button type="button"><u>U</u></button>
      <button type="button">Tx</button>
      <button type="button"><span class="color-dot">A</span></button>
      <i />
      <button type="button">≡</button>
      <button type="button">≣</button>
      <button type="button">☷</button>
      <button type="button">↔</button>
      <i />
      <button type="button">↶</button>
      <button type="button">↷</button>
    </div>

    <div class="toolbar toolbar-secondary">
      <button type="button"><span class="tool-icon">•</span> 无序列表</button>
      <button type="button"><span class="tool-icon">1.</span> 有序列表</button>
      <button type="button">❝ 引用</button>
      <button type="button">🔗 链接</button>
      <button type="button">▧ 图片</button>
      <button type="button">▶ 视频</button>
      <button type="button">▦ 表格</button>
      <button type="button">— 分割线</button>
      <span class="device-preview"><t-icon name="desktop" /> PC 预览</span>
    </div>

    <div class="editor-stage">
      <div class="ruler"><span v-for="item in 12" :key="item" /></div>
      <article class="canvas">
        <img v-if="cover" :src="cover" alt="商品图文内容" class="cover-image" />
        <div class="article-intro">
          <p class="article-kicker">PRODUCT DETAILS</p>
          <h3>商品图文详情</h3>
          <div class="gold-line" />
          <textarea
            :value="modelValue"
            class="editor-textarea"
            placeholder="请输入图文详情，可包含材质说明、实拍图说明、使用场景和售后说明"
            @input="handleInput"
          />
        </div>
        <div class="feature-grid">
          <div><strong>优选材质</strong><span>天然纹理</span></div>
          <div><strong>精工细作</strong><span>品质呈现</span></div>
          <div><strong>平台甄选</strong><span>统一维护</span></div>
        </div>
      </article>
    </div>

    <footer class="editor-footer"><span>图文内容实时编辑</span><span>运营后台</span></footer>
  </section>
</template>

<script setup lang="ts">
defineProps<{ modelValue: string; cover?: string }>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const handleInput = (event: Event) => {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
};
</script>

<style scoped>
.rich-editor-preview {
  width: 1200px;
  overflow: hidden;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 2px 10px rgb(0 0 0 / 6%);
}
.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 50px;
  padding: 0 20px;
  border-bottom: 1px solid #e7e7e7;
  background: #fff;
}
.editor-title,
.editor-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.editor-title {
  color: #1f2329;
  font-weight: 600;
  font-size: 14px;
}
.editor-title .t-icon {
  color: var(--td-brand-color);
}
.editor-state {
  color: var(--td-brand-color);
  font-size: 12px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 16px;
  border-bottom: 1px solid #e7e7e7;
}
.toolbar-primary {
  min-height: 46px;
  background: #f7f8fa;
}
.toolbar-secondary {
  min-height: 42px;
  background: #fff;
}
.toolbar button {
  height: 28px;
  padding: 0 9px;
  color: #6d7280;
  cursor: default;
  background: transparent;
  border: 0;
  border-radius: 4px;
  font-size: 13px;
  white-space: nowrap;
}
.toolbar .select-tool {
  min-width: 72px;
  color: #5f6673;
  text-align: left;
  background: #fff;
  border: 1px solid #e2e5ea;
}
.toolbar .select-tool span {
  float: right;
  margin-left: 10px;
}
.toolbar .font-tool {
  min-width: 96px;
}
.toolbar .size-tool {
  min-width: 52px;
}
.toolbar i {
  width: 1px;
  height: 20px;
  margin: 0 5px;
  background: #e2e5ea;
}
.color-dot {
  color: #6d7280;
  text-decoration: underline 3px #e95b5b;
}
.tool-icon {
  font-size: 11px;
}
.device-preview {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  color: #9ba1aa;
  font-size: 12px;
}
.editor-stage {
  padding: 24px 40px 30px;
  background: #f3f5f8;
}
.ruler {
  display: flex;
  width: 820px;
  height: 15px;
  margin: 0 auto 5px;
  justify-content: space-between;
  border-top: 1px solid #c7cad0;
}
.ruler span {
  height: 6px;
  border-left: 1px solid #c7cad0;
}
.canvas {
  width: 820px;
  min-height: 420px;
  margin: 0 auto;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 2px 8px rgb(0 0 0 / 14%);
}
.cover-image {
  display: block;
  width: 100%;
  height: 280px;
  object-fit: cover;
}
.article-intro {
  padding: 42px 72px 34px;
  color: #393939;
  text-align: center;
}
.article-kicker {
  margin: 0;
  color: #aa875d;
  font-size: 11px;
  letter-spacing: 4px;
}
.article-intro h3 {
  margin: 12px 0 10px;
  font-size: 26px;
  font-weight: 500;
  letter-spacing: 3px;
}
.gold-line {
  width: 34px;
  height: 2px;
  margin: 0 auto 22px;
  background: #b88b51;
}
.editor-textarea {
  width: 100%;
  min-height: 170px;
  resize: vertical;
  color: #6a6a6a;
  line-height: 2;
  text-align: left;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: 12px;
  font: inherit;
}
.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  padding: 24px 40px;
  color: #fff;
  text-align: center;
  background: #303236;
}
.feature-grid div {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-right: 1px solid rgb(255 255 255 / 22%);
}
.feature-grid div:last-child {
  border-right: 0;
}
.feature-grid strong {
  font-size: 14px;
  font-weight: 500;
}
.feature-grid span {
  color: #c8c8c8;
  font-size: 12px;
}
.editor-footer {
  display: flex;
  justify-content: space-between;
  padding: 9px 16px;
  color: #9ba1aa;
  border-top: 1px solid #e7e7e7;
  background: #fafafa;
  font-size: 11px;
}
@media (max-width: 1220px) {
  .rich-editor-preview {
    width: 100%;
  }
  .toolbar-secondary,
  .toolbar-primary {
    overflow-x: auto;
  }
  .canvas,
  .ruler {
    width: min(820px, 100%);
  }
  .editor-stage {
    padding: 20px;
  }
}
</style>
