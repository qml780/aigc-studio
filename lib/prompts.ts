import type { KeywordSet } from './validation.ts';

type PromptProject = { characterKeywords: KeywordSet; styleKeywords: KeywordSet; defaultQuality: string[] };
const unique = (words: string[]) => [...new Set(words.map(word => word.trim()).filter(Boolean))];

export function promptLayers(project: PromptProject) {
  const character = project.characterKeywords;
  const style = project.styleKeywords;
  return {
    character: unique([...character.features, ...character.hairstyle, ...character.clothing, ...character.colors]),
    style: unique([...character.style, ...style.style, ...style.features, ...style.hairstyle, ...style.clothing, ...style.colors]),
    quality: unique([...project.defaultQuality, ...character.quality, ...style.quality]),
  };
}

export function composePrompt(project: PromptProject, scene: string) {
  const layers = promptLayers(project);
  return [layers.character.join(', '), layers.style.join(', '), scene.trim(), layers.quality.join(', ')].filter(Boolean).join(', ');
}
