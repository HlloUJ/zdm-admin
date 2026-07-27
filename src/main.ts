import { createApp } from 'vue';
import TDesign from 'tdesign-vue-next';

import App from './App.vue';
import router from './router';

import 'tdesign-vue-next/es/style/index.css';
import '@zdm-admin-ui/styles/index.css';
import './styles/index.css';

const app = createApp(App);

app.use(TDesign);
app.use(router);

app.mount('#app');
