// Host-owned benchmark profiles. Client payloads cannot choose pricing/routing.
export const DEEPSEEK = 'deepseek/deepseek-v4.1-flash';
export const GLM_FLASH = 'z-ai/glm-5.3-flash';
const profiles = {
  [DEEPSEEK]: { model: DEEPSEEK, input: .30, output: 1.20, cacheRead: .006 },
  [GLM_FLASH]: { model: GLM_FLASH, input: .15, output: .50, cacheRead: .03 },
};
export function generatorProfile(model = DEEPSEEK) {
  if (!Object.hasOwn(profiles, model)) throw Error('Unsupported benchmark generator');
  return { ...profiles[model] };
}
