import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jewelrytracker.app',
  appName: '首饰管家',
  webDir: 'dist',

  // 开发时取消注释下面两行，连到 Vite dev server 实现热更新
  // server: {
  //   url: 'http://192.168.1.x:5173',
  //   cleartext: true,
  // },

  ios: {
    scheme: 'JewelryTracker',
  },

  android: {
    allowMixedContent: true,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,       // 启动页显示 2 秒
      backgroundColor: '#fdf6f0',     // 与网站背景色一致
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'dark',                  // 浅色背景用深色状态栏文字
      backgroundColor: '#fdf6f0',
    },
  },
};

export default config;
