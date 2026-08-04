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
      launchShowDuration: 2000,
      backgroundColor: '#2c2416',     // 深棕色开屏背景
      showSpinner: false,
      launchAutoHide: false,          // JS 端 hideSplashScreen() 手动隐藏
    },
    StatusBar: {
      style: 'light',                 // 深色背景用浅色状态栏文字
      backgroundColor: '#2c2416',
    },
  },
};

export default config;
