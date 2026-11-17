import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
export default [
 {ignores:['**/dist/**','**/node_modules/**','**/.data/**']},
 ...tseslint.configs.recommended,
 ...vue.configs['flat/essential'],
 {files:['**/*.vue'],languageOptions:{parserOptions:{parser:tseslint.parser,extraFileExtensions:['.vue']}}},
 {rules:{'@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}],'vue/multi-word-component-names':'off','@typescript-eslint/no-non-null-assertion':'off'}},
];
