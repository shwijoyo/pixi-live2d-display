if (!(window as any).Live2DCubismCore) {
    throw new Error('Missing Cubism 4 runtime. Did you forget to include the live2dcubismcore.min.js?');
}
