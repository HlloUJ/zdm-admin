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
    },
  },
);
