package ai.dpdpguard.offline

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Autolinked entry point for [DpdpGuardOfflineModule]. */
class DpdpGuardOfflinePackage : BaseReactPackage() {

  override fun getModule(
    name: String,
    reactContext: ReactApplicationContext,
  ): NativeModule? = if (name == DpdpGuardOfflineModule.NAME) {
    DpdpGuardOfflineModule(reactContext)
  } else {
    null
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      DpdpGuardOfflineModule.NAME to ReactModuleInfo(
        DpdpGuardOfflineModule.NAME,
        DpdpGuardOfflineModule.NAME,
        false, // canOverrideExistingModule
        false, // needsEagerInit
        false, // isCxxModule
        true, // isTurboModule
      ),
    )
  }
}
