import js from '@eslint/js';
import vue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'backend/**', 'coverage/**', 'playwright-report/**', 'test-results/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-indent': 'off',
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/no-v-html': 'off',
      'vue/no-side-effects-in-computed-properties': 'warn',
      'vue/singleline-html-element-content-newline': 'off',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'tdesign-vue-next',
              importNames: ['DialogPlugin', 'MessagePlugin', 'NotifyPlugin'],
              message: '业务模块必须通过 @/components/foundation 的统一反馈基座展示提示。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/components/foundation/feedback/adminFeedback.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
);
