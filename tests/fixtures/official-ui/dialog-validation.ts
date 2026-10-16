import { createApp } from 'vue';
import TDesign from 'tdesign-vue-next';
import 'tdesign-vue-next/es/style/index.css';
import DialogValidation from './DialogValidation.vue';
if (new URLSearchParams(location.search).get('kind') !== 'native') await import('@/styles/index.css');
createApp(DialogValidation).use(TDesign).mount('#app');
