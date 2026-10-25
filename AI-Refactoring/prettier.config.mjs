/**
 * Local Prettier configuration.
 *
 * Values mirror the formatting used by the `aws-sc-foundation` packages so that both
 * repositories read the same way, without taking a dependency on the private
 * `@ccoe-aws/ccoe-config` package (which would require registry authentication for
 * local validation).
 */
export default {
  printWidth: 120,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  trailingComma: 'none',
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'lf'
};
