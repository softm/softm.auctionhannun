package softm.realestate.auctionhannun;

import android.app.Activity;
import android.widget.LinearLayout;
import softm.hannun.ads.HannunAdConfig;
import softm.hannun.ads.HannunAds;

/** 경매한눈 화면을 한눈서비스 공통 AdMob 구현에 연결한다. */
final class AdMobController {
    private final HannunAds delegate;

    AdMobController(Activity activity, LinearLayout section) {
        delegate = BuildConfig.ADMOB_ENABLED ? new HannunAds(activity, section, new HannunAdConfig(
            BuildConfig.ADMOB_NATIVE_ID, null,
            BuildConfig.ADMOB_INTERSTITIAL_ID,
            BuildConfig.ADMOB_MREC_ID)) : null;
        if (delegate == null) section.setVisibility(android.view.View.GONE);
    }

    void start() { if (delegate != null) delegate.start(); }
    void showExitDialog() { if (delegate != null) delegate.showExitConfirmation(); }
    void setContentReady(boolean ready) { if (delegate != null) delegate.setSuppressed(!ready); }
    void pause() { if (delegate != null) delegate.onPause(); }
    void resume() { if (delegate != null) delegate.onResume(); }
    void destroy() { if (delegate != null) delegate.destroy(); }
}
