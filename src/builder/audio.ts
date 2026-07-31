import { AudioBank, AudioPlayback } from '../audio/playback'

/**
 * 編集セッションが使う音の所有者。
 *
 * アセット一覧の試し聞き、再生モードの効果音、BGMの3つが同じものを使う。
 * AudioContext は最初に鳴らすまで作られないので、ここで持っていても
 * 自動再生制限には触れない。作品データには何も残さない。
 */
export const builderBank = new AudioBank()
export const builderBgm = new AudioPlayback()
