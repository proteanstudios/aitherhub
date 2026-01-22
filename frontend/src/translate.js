import i18n, { t as i18nT } from './i18n';

// prefer named export `t` for clean imports: `import { t } from '../translate'`
export const t = i18nT || ((k, opts) => i18n.t(k, opts));

export default t;
