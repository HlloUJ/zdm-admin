import { createApp } from 'vue';
import TDesign from 'tdesign-vue-next';
import 'tdesign-vue-next/es/style/index.css';
import '@/styles/index.css';
import FeedbackLayout from './FeedbackLayout.vue';
createApp(FeedbackLayout).use(TDesign).mount('#app');
