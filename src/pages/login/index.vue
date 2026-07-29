<template>
  <main class="login-wrapper light">
    <header class="login-header">
      <div class="brand-mark">装点猫</div>
      <span>管理后台</span>
    </header>

    <section class="login-container" aria-label="登录">
      <div class="title-container">
        <h1 class="title margin-no">欢迎登录</h1>
        <h2 class="title">装点猫管理后台</h2>
      </div>

      <t-form
        ref="formRef"
        class="item-container login-phone"
        :data="formData"
        :rules="FORM_RULES"
        label-width="0"
        @submit="onSubmit"
      >
        <t-form-item name="phone">
          <t-input v-model="formData.phone" size="large" clearable :maxlength="11" placeholder="请输入手机号">
            <template #prefix-icon>
              <t-icon name="mobile" />
            </template>
          </t-input>
        </t-form-item>

        <t-form-item class="verification-code" name="verifyCode">
          <t-input
            :model-value="formData.verifyCode"
            size="large"
            clearable
            placeholder="请输入验证码"
            @update:model-value="normalizeVerifyCode"
          />
          <t-button size="large" variant="outline" :disabled="countDown > 0" @click="sendCode">
            {{ countDown > 0 ? `${countDown}s` : '获取验证码' }}
          </t-button>
        </t-form-item>

        <div class="check-container remember-account">
          <t-checkbox v-model="formData.rememberAccount">记住账号</t-checkbox>
        </div>

        <t-form-item class="btn-container">
          <t-button block size="large" type="submit" :loading="submitting">登录</t-button>
        </t-form-item>
      </t-form>
    </section>
  </main>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, SubmitContext } from 'tdesign-vue-next';
import { MessagePlugin } from 'tdesign-vue-next';
import { onBeforeUnmount, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { login } from '@/services/auth';
import { getFirstAccessiblePath } from '@/services/adminPermissions';

const router = useRouter();
const countDown = ref(0);
const submitting = ref(false);
const formRef = ref<FormInstanceFunctions>();
let timer: number | undefined;

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const VERIFY_CODE_PATTERN = /^\d{6}$/;
const FORM_RULES: Record<string, FormRule[]> = {
  phone: [
    { required: true, message: '请输入手机号', type: 'error' },
    { pattern: PHONE_PATTERN, message: '请输入正确的手机号', type: 'error' },
  ],
  verifyCode: [
    { required: true, message: '请输入验证码', type: 'error' },
    { pattern: VERIFY_CODE_PATTERN, message: '请输入6位验证码', type: 'error' },
  ],
};

const formData = reactive({
  phone: '',
  verifyCode: '',
  rememberAccount: false,
});

const stopCounter = () => {
  if (timer) {
    window.clearInterval(timer);
    timer = undefined;
  }
};

const startCounter = () => {
  countDown.value = 60;
  stopCounter();
  timer = window.setInterval(() => {
    countDown.value -= 1;
    if (countDown.value <= 0) {
      countDown.value = 0;
      stopCounter();
    }
  }, 1000);
};

const normalizeVerifyCode = (value: unknown) => {
  formData.verifyCode = String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 6);
};

const sendCode = async () => {
  if (countDown.value > 0) return;

  const validateResult = await formRef.value?.validate({ fields: ['phone'] });
  if (validateResult === true) {
    startCounter();
  }
};

const onSubmit = async (ctx: SubmitContext) => {
  if (ctx.validateResult !== true || submitting.value) return;

  submitting.value = true;
  try {
    const result = await login({
      phone: formData.phone,
      verifyCode: formData.verifyCode,
    });
    await router.push(getFirstAccessiblePath(result.user) || '/dashboard');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '登录失败，请稍后重试');
  } finally {
    submitting.value = false;
  }
};

onBeforeUnmount(stopCounter);
</script>

<style scoped>
.login-wrapper {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: #fff;
  background-image: url('@/assets/assets-login-bg-white.png');
  background-position: 100% center;
  background-size: cover;
}

.login-header {
  height: 64px;
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
  padding: 0 5%;
  color: var(--td-text-color-primary);
  font: var(--td-font-title-medium);
}

.brand-mark {
  height: 32px;
  min-width: 82px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: #fff;
  background: var(--td-brand-color);
  font: var(--td-font-title-small);
}

.login-container {
  position: absolute;
  top: 22%;
  left: 5%;
  width: min(400px, calc(100vw - 48px));
}

.title-container .title {
  margin: var(--td-comp-margin-xs) 0 0;
  color: var(--td-text-color-primary);
  font: var(--td-font-headline-large);
  letter-spacing: 0;
}

.title-container .title.margin-no {
  margin-top: 0;
}

.item-container {
  width: 100%;
  margin-top: var(--td-comp-margin-xxxxl);
}

.verification-code {
  display: flex;
  align-items: center;
}

.verification-code :deep(.t-form__controls) {
  width: 100%;
}

.verification-code :deep(.t-form__controls-content) {
  display: flex;
  gap: var(--td-comp-margin-l);
}

.verification-code :deep(.t-button) {
  width: 128px;
  flex-shrink: 0;
}

.check-container {
  margin-top: var(--td-comp-margin-xs);
  font: var(--td-font-body-medium);
  color: var(--td-text-color-secondary);
}

.btn-container {
  margin-top: var(--td-comp-margin-xxxxl);
}

@media (max-width: 720px) {
  .login-wrapper {
    background-position: 58% center;
  }

  .login-container {
    top: 18%;
  }

  .title-container .title {
    font: var(--td-font-headline-medium);
  }
}
</style>
