export {};

declare global {
  /** 设置页「应用图标」一栏读到的状态：预设缩略图 + 自定义图预览。 */
  interface AppIconState {
    /** 当前选中：default（应用自己的图标）/ 预设 id / custom。 */
    preset: string;
    presets: { id: string; dataUrl: string | null }[];
    /** 自定义图的预览；没上传过就是 null。 */
    custom: string | null;
  }

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
      /**
       * 应用图标：换掉任务栏和托盘图标，投屏时不暴露应用。
       * 文件选择和落盘都在主进程做，页面只拿得到预览图。
       */
      appIcon?: {
        get: () => Promise<AppIconState>;
        /** 切预设；非法 id 或还没自定义图时原样返回当前状态。 */
        set: (preset: string) => Promise<AppIconState>;
        /** 弹文件框选图片；用户取消返回 null。 */
        pickImage: () => Promise<AppIconState | null>;
        /**
         * 重启应用。任务栏图标要等按钮重建才认，
         * 所以换完图标给个「立即重启」的入口。
         */
        relaunch: () => Promise<boolean>;
      };
      /**
       * 悬浮窗：面试中弹出的置顶小窗，只显示回答。
       * 打开时主窗口隐藏（面试照跑）；回主窗口时把窗口叫回来。
       * 「结束面试」由主进程转回主窗口，走正常收尾。
       */
      float?: {
        open: () => void;
        back: () => void;
        end: () => void;
        /** 悬浮窗发来的动作，目前只有 "end"。返回退订函数。 */
        onCommand: (listener: (action: string) => void) => () => void;
      };
    };
  }
}
