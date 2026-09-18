import { createCosmosVisionPublicApi, type SettingsSource } from './service';
import type { CosmosVisionPublicApi } from './types';

export type * from './types';

const REGISTRATION_KEY = Symbol.for('cosmos-vision.public-api.1');
export interface PublicApiRegistration {
  api: CosmosVisionPublicApi;
  /** 首次初始化返回 true，重复注册保留原实例与设置来源。 */
  initialize(getSettings: SettingsSource): boolean;
  capabilitiesChanged(): void;
}

/** 重复加载时保留同一个实例、去重记录和其他插件添加的公开成员。 */
export function registerCosmosVisionPublicApi(target: Window = window): PublicApiRegistration {
  const host = target as Window & { [REGISTRATION_KEY]?: PublicApiRegistration };
  if (host[REGISTRATION_KEY]) return host[REGISTRATION_KEY];
  let settingsSource: SettingsSource = () => undefined;
  let initialized = false;
  const api = Object.assign(
    target.CosmosVision ?? {},
    createCosmosVisionPublicApi(() => settingsSource()),
  );
  const registration: PublicApiRegistration = {
    api,
    initialize(getSettings) {
      if (initialized) return false;
      initialized = true;
      settingsSource = getSettings;
      registration.capabilitiesChanged();
      return true;
    },
    capabilitiesChanged() {
      target.dispatchEvent(new CustomEvent('cosmos-vision:capabilities-changed'));
    },
  };
  Object.defineProperty(host, REGISTRATION_KEY, { value: registration });
  target.CosmosVision = api;
  target.dispatchEvent(new CustomEvent('cosmos-vision:ready'));
  return registration;
}
