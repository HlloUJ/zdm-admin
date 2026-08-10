<template>
  <main class="invite-wrapper">
    <section class="invite-container" aria-label="员工注册">
      <div v-if="loading" class="state-panel">
        <t-loading size="small" text="" />
        <span>正在打开邀请链接</span>
      </div>

      <div v-else-if="pageError" class="state-panel">
        <h1>邀请链接不可用</h1>
        <p>{{ pageError }}</p>
      </div>

      <div v-else-if="submitted" class="state-panel">
        <h1>注册信息已提交</h1>
        <p>请等待超级管理员确认信息并启用账号。</p>
      </div>

      <template v-else>
        <div class="page-title">
          <h1>员工注册</h1>
          <p>请完成信息填写，提交后等待管理员启用。</p>
        </div>

        <t-steps class="invite-steps" :current="step - 1" theme="dot">
          <t-step-item title="验证手机" />
          <t-step-item title="姓名性别" />
        </t-steps>

        <t-form
          v-if="step === 1"
          ref="phoneFormRef"
          class="item-container"
          :data="phoneForm"
          :rules="PHONE_FORM_RULES"
          label-width="0"
          @submit="handlePhoneSubmit"
        >
          <t-form-item name="phone">
            <t-input
              :model-value="phoneForm.phone"
              size="large"
              clearable
              :maxlength="11"
              placeholder="请输入手机号"
              @update:model-value="normalizePhone"
            />
          </t-form-item>

          <t-form-item class="verification-code" name="verifyCode">
            <t-input
              :model-value="phoneForm.verifyCode"
              size="large"
              clearable
              placeholder="请输入验证码"
              @update:model-value="normalizeVerifyCode"
            />
            <t-button
              size="large"
              variant="outline"
              :disabled="countDown > 0 || requestingCode"
              :loading="requestingCode"
              @click="sendCode"
            >
              {{ countDown > 0 ? `${countDown}s` : '获取验证码' }}
            </t-button>
          </t-form-item>

          <t-form-item class="btn-container">
            <t-button block size="large" type="submit" :loading="submitting">下一步</t-button>
          </t-form-item>
        </t-form>

        <t-form
          v-else
          ref="profileFormRef"
          class="item-container"
          :data="profileForm"
          :rules="PROFILE_FORM_RULES"
          label-width="0"
          @submit="handleProfileSubmit"
        >
          <t-form-item name="name">
            <t-input v-model="profileForm.name" size="large" clearable placeholder="请输入姓名" />
          </t-form-item>

          <t-form-item name="gender">
            <t-radio-group v-model="profileForm.gender" class="gender-radio">
              <t-radio-button value="male">男</t-radio-button>
              <t-radio-button value="female">女</t-radio-button>
            </t-radio-group>
          </t-form-item>

          <t-form-item class="btn-container">
            <div class="profile-actions">
              <t-button size="large" variant="outline" @click="step = 1">上一步</t-button>
              <t-button size="large" type="submit" :loading="submitting">提交注册</t-button>
            </div>
          </t-form-item>
        </t-form>
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { adminFeedback } from '@/components/foundation';
import type { FormInstanceFunctions, FormRule, SubmitContext } from 'tdesign-vue-next';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';

import {
  inspectEmployeeInvite,
  registerEmployeeInvite,
  requestEmployeeInviteCode,
  verifyEmployeeInviteCode,
} from '@/services/employeeInvites';

const route = useRoute();
const token = computed(() => String(route.query.token ?? ''));
const loading = ref(true);
const requestingCode = ref(false);
const submitting = ref(false);
const submitted = ref(false);
const pageError = ref('');
const step = ref<1 | 2>(1);
const countDown = ref(0);
const phoneFormRef = ref<FormInstanceFunctions>();
const profileFormRef = ref<FormInstanceFunctions>();
let timer: number | undefined;

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const VERIFY_CODE_PATTERN = /^\d{6}$/;
const PHONE_FORM_RULES: Record<string, FormRule[]> = {
  phone: [
    { required: true, message: '请输入手机号', type: 'error' },
    { pattern: PHONE_PATTERN, message: '请输入正确的手机号', type: 'error' },
  ],
  verifyCode: [
    { required: true, message: '请输入验证码', type: 'error' },
    { pattern: VERIFY_CODE_PATTERN, message: '请输入6位验证码', type: 'error' },
  ],
};
const PROFILE_FORM_RULES: Record<string, FormRule[]> = {
  name: [{ required: true, message: '请输入姓名', type: 'error' }],
  gender: [{ required: true, message: '请选择性别', type: 'error' }],
};

const phoneForm = reactive({
  phone: '',
  verifyCode: '',
});

const profileForm = reactive<{
  name: string;
  gender: '' | 'male' | 'female';
}>({
  name: '',
  gender: '',
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

const normalizePhone = (value: unknown) => {
  phoneForm.phone = String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 11);
};

const normalizeVerifyCode = (value: unknown) => {
  phoneForm.verifyCode = String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 6);
};

const sendCode = async () => {
  if (countDown.value > 0 || requestingCode.value || submitting.value) return;
  const validateResult = await phoneFormRef.value?.validate({ fields: ['phone'] });
  if (validateResult !== true) return;

  requestingCode.value = true;
  try {
    await requestEmployeeInviteCode(token.value, { phone: phoneForm.phone });
    startCounter();
    adminFeedback.success('验证码已发送');
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '验证码获取失败');
  } finally {
    requestingCode.value = false;
  }
};

const handlePhoneSubmit = async (ctx: SubmitContext) => {
  if (ctx.validateResult !== true || submitting.value) return;
  submitting.value = true;
  try {
    await verifyEmployeeInviteCode(token.value, phoneForm);
    step.value = 2;
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '验证码校验失败');
  } finally {
    submitting.value = false;
  }
};

const handleProfileSubmit = async (ctx: SubmitContext) => {
  if (ctx.validateResult !== true || submitting.value || profileForm.gender === '') return;
  submitting.value = true;
  try {
    await registerEmployeeInvite(token.value, {
      phone: phoneForm.phone,
      verifyCode: phoneForm.verifyCode,
      name: profileForm.name.trim(),
      gender: profileForm.gender,
    });
    submitted.value = true;
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '注册提交失败');
  } finally {
    submitting.value = false;
  }
};

onMounted(async () => {
  if (!token.value) {
    pageError.value = '邀请链接缺少 token';
    loading.value = false;
    return;
  }
  try {
    await inspectEmployeeInvite(token.value);
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : '邀请链接校验失败';
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(stopCounter);
</script>

<style scoped>
.invite-wrapper {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: #fff;
}

.invite-container {
  width: min(420px, calc(100vw - 40px));
  margin: 0 auto;
  padding: 32px 0;
}

.page-title {
  margin-bottom: var(--td-comp-margin-xxl);
  text-align: center;
}

.page-title h1 {
  margin: 0;
  color: var(--td-text-color-primary);
  font: var(--td-font-headline-medium);
  letter-spacing: 0;
}

.page-title p {
  margin: var(--td-comp-margin-s) 0 0;
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-medium);
}

.invite-steps {
  margin-bottom: var(--td-comp-margin-xxl);
}

.item-container {
  width: 100%;
}

.item-container :deep(.t-form__item) {
  margin-bottom: var(--td-comp-margin-l);
}

.item-container :deep(.t-input),
.item-container :deep(.t-button),
.gender-radio :deep(.t-radio-button) {
  border-radius: 8px;
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
  gap: var(--td-comp-margin-m);
}

.verification-code :deep(.t-button) {
  width: 116px;
  flex-shrink: 0;
}

.btn-container {
  margin-top: var(--td-comp-margin-xl);
}

.profile-actions {
  display: grid;
  grid-template-columns: 104px 1fr;
  gap: var(--td-comp-margin-m);
  width: 100%;
}

.gender-radio {
  width: 100%;
}

.gender-radio :deep(.t-radio-button) {
  width: 50%;
  text-align: center;
}

.state-panel {
  min-height: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--td-comp-margin-s);
  text-align: center;
}

.state-panel h1 {
  margin: 0;
  color: var(--td-text-color-primary);
  font: var(--td-font-title-large);
  letter-spacing: 0;
}

.state-panel p,
.state-panel span {
  margin: 0;
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-medium);
}

@media (max-width: 720px) {
  .invite-container {
    width: calc(100vw - 36px);
    padding: 28px 0;
  }

  .page-title h1 {
    font: var(--td-font-title-large);
  }

  .profile-actions {
    grid-template-columns: 104px 1fr;
  }
}
</style>
