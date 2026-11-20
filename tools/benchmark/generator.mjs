// Host-owned benchmark profiles. Client payloads cannot choose pricing/routing.
export const DEEPSEEK = 'deepseek/deepseek-v4.1-flash';
export const GLM_FLASH = 'z-ai/glm-5.3-flash';
const profiles = {
  [DEEPSEEK]: { model: DEEPSEEK, input: 0.3, output: 1.2, cacheRead: 0.006 },
  [GLM_FLASH]: { model: GLM_FLASH, input: 0.15, output: 0.5, cacheRead: 0.03 },
};
export function generatorProfile(model = DEEPSEEK) {
  if (!Object.hasOwn(profiles, model)) throw Error('Unsupported benchmark generator');
  return { ...profiles[model] };
}
