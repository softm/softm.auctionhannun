package softm.realestate.auctionhannun;

import android.app.Activity;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;

import com.google.android.gms.ads.AdListener;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.AdSize;
import com.google.android.gms.ads.AdView;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.FormError;
import com.google.android.ump.UserMessagingPlatform;

import java.util.concurrent.atomic.AtomicBoolean;

final class AdMobController {
    private final Activity activity;
    private final FrameLayout bannerHost;
    private final Button privacyButton;
    private final ConsentInformation consentInformation;
    private final AtomicBoolean initialized = new AtomicBoolean(false);
    private AdView banner;

    AdMobController(Activity activity, FrameLayout bannerHost, Button privacyButton) {
        this.activity = activity;
        this.bannerHost = bannerHost;
        this.privacyButton = privacyButton;
        this.consentInformation = UserMessagingPlatform.getConsentInformation(activity);
        privacyButton.setOnClickListener(view -> showPrivacyOptions());
    }

    void start() {
        if (!BuildConfig.ADMOB_ENABLED) {
            hideAdvertisingUi();
            return;
        }
        ConsentRequestParameters parameters = new ConsentRequestParameters.Builder()
            .setTagForUnderAgeOfConsent(false)
            .build();
        consentInformation.requestConsentInfoUpdate(
            activity,
            parameters,
            () -> UserMessagingPlatform.loadAndShowConsentFormIfRequired(
                activity,
                formError -> {
                    updatePrivacyButton();
                    initializeAdsWhenAllowed();
                }
            ),
            requestError -> {
                updatePrivacyButton();
                initializeAdsWhenAllowed();
            }
        );
        initializeAdsWhenAllowed();
    }

    private void initializeAdsWhenAllowed() {
        if (!consentInformation.canRequestAds() || !initialized.compareAndSet(false, true)) return;
        MobileAds.initialize(activity, status -> activity.runOnUiThread(this::loadBanner));
    }

    private void loadBanner() {
        if (activity.isFinishing() || banner != null) return;
        banner = new AdView(activity);
        banner.setAdUnitId(BuildConfig.ADMOB_BANNER_ID);
        float density = activity.getResources().getDisplayMetrics().density;
        int availableWidthDp = Math.max(320,
            (int) (activity.getResources().getDisplayMetrics().widthPixels / density));
        banner.setAdSize(AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(
            activity,
            availableWidthDp
        ));
        banner.setAdListener(new AdListener() {
            @Override
            public void onAdLoaded() {
                bannerHost.setVisibility(View.VISIBLE);
            }

            @Override
            public void onAdFailedToLoad(LoadAdError error) {
                bannerHost.setVisibility(View.GONE);
            }
        });
        bannerHost.removeAllViews();
        bannerHost.addView(banner, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            android.view.Gravity.CENTER
        ));
        banner.loadAd(new AdRequest.Builder().build());
    }

    private void updatePrivacyButton() {
        boolean required = consentInformation.getPrivacyOptionsRequirementStatus()
            == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
        privacyButton.setVisibility(required ? View.VISIBLE : View.GONE);
    }

    private void showPrivacyOptions() {
        UserMessagingPlatform.showPrivacyOptionsForm(activity, this::onPrivacyOptionsClosed);
    }

    private void onPrivacyOptionsClosed(FormError error) {
        updatePrivacyButton();
        initializeAdsWhenAllowed();
    }

    private void hideAdvertisingUi() {
        bannerHost.setVisibility(View.GONE);
        privacyButton.setVisibility(View.GONE);
    }

    void pause() {
        if (banner != null) banner.pause();
    }

    void resume() {
        if (banner != null) banner.resume();
    }

    void destroy() {
        if (banner != null) {
            banner.destroy();
            banner = null;
        }
        bannerHost.removeAllViews();
    }
}
