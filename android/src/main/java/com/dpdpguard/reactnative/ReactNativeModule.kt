package com.dpdpguard.reactnative

import com.facebook.react.bridge.ReactApplicationContext

class ReactNativeModule(reactContext: ReactApplicationContext) :
  NativeReactNativeSpec(reactContext) {

  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }

  companion object {
    const val NAME = NativeReactNativeSpec.NAME
  }
}
