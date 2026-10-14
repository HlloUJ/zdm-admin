import { createApp } from 'vue';
import TDesign from 'tdesign-vue-next';
import 'tdesign-vue-next/es/style/index.css';
import './upstream/vendor/tdesign-vue-next/es/style/index.css';
import './upstream/vendor/tdesign-vue-next/es/form/style/index.css';
import './reference-reset.css';
import UpstreamReference from './UpstreamReference.vue';
createApp(UpstreamReference).use(TDesign).mount('#app');
