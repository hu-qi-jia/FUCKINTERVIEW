export {};

declare global {
  interface Window {
    /** 由 desktop/electron/preload.js 注入；浏览器里不存在。 */
    desktop?: {
      isDesktop: true;
      platform: string;
      minimize: () => void;
      toggleMaximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      onMaximizeChange: (listener: (maximized: boolean) => void) => () => void;
      /** 防截屏 / 防录屏（桌面端由主进程的窗口保护实现）。 */
      privacy?: {
        getContentProtection: () => Promise<boolean>;
        setContentProtection: (enabled: boolean) => Promise<boolean>;
      };
    };
  }
}
