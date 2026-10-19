import { createApp } from 'vue';
import TDesign from 'tdesign-vue-next';
import 'tdesign-vue-next/es/style/index.css';
import '@/styles/index.css';
import TextareaCount from './TextareaCount.vue';
createApp(TextareaCount).use(TDesign).mount('#app');
