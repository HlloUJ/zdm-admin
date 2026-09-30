module.exports = {
  extends: ['stylelint-config-standard', 'stylelint-config-standard-vue'],
  ignoreFiles: ['dist/**/*', 'node_modules/**/*', 'backend/target/**/*'],
  rules: {
    'selector-class-pattern': null,
    'custom-property-pattern': null,
    'at-rule-empty-line-before': null,
    'declaration-block-no-shorthand-property-overrides': null,
    'declaration-block-single-line-max-declarations': null,
    'declaration-property-value-keyword-no-deprecated': null,
    'media-feature-range-notation': null,
    'no-descending-specificity': null,
    'no-duplicate-selectors': null,
    'rule-empty-line-before': null,
  },
  overrides: [
    {
      files: [
        'src/pages/{finished-stock,slab}/{management,supply-chain,shared}/index.css',
        'src/pages/finished-stock/store/index.css',
      ],
      rules: {
        'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['deep'] }],
      },
    },
  ],
};
