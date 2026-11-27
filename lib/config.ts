export const experimentalEnabled = () => process.env.AIGC_ENABLE_EXPERIMENTAL === 'true';

export function getCapabilities() {
  return {
    chat: Boolean(process.env.ARK_API_KEY && process.env.ARK_CHAT_MODEL),
    vision: Boolean(process.env.ARK_API_KEY && process.env.ARK_VISION_MODEL),
    image: Boolean(process.env.VOLCENGINE_AK && process.env.VOLCENGINE_SK),
    experimental: experimentalEnabled(),
  };
}
