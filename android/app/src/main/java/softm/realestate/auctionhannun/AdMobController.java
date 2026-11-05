package softm.realestate.auctionhannun;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.android.gms.ads.AdListener;
import com.google.android.gms.ads.AdLoader;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.AdSize;
import com.google.android.gms.ads.AdView;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.interstitial.InterstitialAd;
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback;
import com.google.android.gms.ads.nativead.NativeAd;
import com.google.android.gms.ads.nativead.NativeAdOptions;
import com.google.android.gms.ads.nativead.NativeAdView;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.FormError;
import com.google.android.ump.UserMessagingPlatform;

import java.util.concurrent.atomic.AtomicBoolean;

final class AdMobController {
    private static final long FIRST_INTERSTITIAL_DELAY_MS = 75_000L;
    private static final long INTERSTITIAL_INTERVAL_MS = 180_000L;
    private static final int MAX_INTERSTITIALS_PER_SESSION = 3;

    private final Activity activity;
    private final FrameLayout nativeHost;
    private final Button privacyButton;
    private final ConsentInformation consentInformation;
    private final AtomicBoolean initialized = new AtomicBoolean(false);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable interstitialOpportunity = this::showInterstitialIfReady;

    private NativeAd nativeAd;
    private InterstitialAd interstitialAd;
    private boolean interstitialLoading;
    private int interstitialsShown;
    private AdView exitMrecAd;
    private boolean exitMrecLoaded;
    private AlertDialog exitDialog;
    private boolean activityResumed;
    private boolean contentReady;

    AdMobController(Activity activity, FrameLayout nativeHost, Button privacyButton) {
        this.activity = activity;
        this.nativeHost = nativeHost;
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
        updatePrivacyButton();
        initializeAdsWhenAllowed();
    }

    private void initializeAdsWhenAllowed() {
        if (!consentInformation.canRequestAds() || !initialized.compareAndSet(false, true)) return;
        MobileAds.initialize(activity, status -> activity.runOnUiThread(() -> {
            loadNativeAd();
            loadInterstitialAd();
            loadExitMrecAd();
            handler.postDelayed(interstitialOpportunity, FIRST_INTERSTITIAL_DELAY_MS);
        }));
    }

    private void loadNativeAd() {
        if (activity.isFinishing() || activity.isDestroyed()) return;
        AdLoader loader = new AdLoader.Builder(activity, BuildConfig.ADMOB_NATIVE_ID)
            .forNativeAd(ad -> {
                if (activity.isFinishing() || activity.isDestroyed()) {
                    ad.destroy();
                    return;
                }
                if (nativeAd != null) nativeAd.destroy();
                nativeAd = ad;
                nativeHost.removeAllViews();
                nativeHost.addView(createNativeAdView(ad));
                nativeHost.setVisibility(View.VISIBLE);
            })
            .withAdListener(new AdListener() {
                @Override
                public void onAdFailedToLoad(LoadAdError error) {
                    nativeHost.setVisibility(View.GONE);
                }
            })
            .withNativeAdOptions(new NativeAdOptions.Builder().build())
            .build();
        loader.loadAd(new AdRequest.Builder().build());
    }

    private NativeAdView createNativeAdView(NativeAd ad) {
        NativeAdView adView = (NativeAdView) activity.getLayoutInflater().inflate(
            R.layout.native_ad_compact,
            nativeHost,
            false
        );
        TextView headline = adView.findViewById(R.id.ad_headline);
        headline.setText(ad.getHeadline());
        adView.setHeadlineView(headline);
        TextView advertiser = adView.findViewById(R.id.ad_advertiser);
        advertiser.setText(ad.getAdvertiser());
        advertiser.setVisibility(ad.getAdvertiser() == null ? View.GONE : View.VISIBLE);
        adView.setAdvertiserView(advertiser);
        TextView body = adView.findViewById(R.id.ad_body);
        body.setText(ad.getBody());
        body.setVisibility(ad.getBody() == null ? View.GONE : View.VISIBLE);
        adView.setBodyView(body);
        ImageView icon = adView.findViewById(R.id.ad_app_icon);
        if (ad.getIcon() == null) {
            icon.setVisibility(View.GONE);
        } else {
            icon.setImageDrawable(ad.getIcon().getDrawable());
            icon.setVisibility(View.VISIBLE);
        }
        adView.setIconView(icon);
        Button callToAction = adView.findViewById(R.id.ad_call_to_action);
        callToAction.setText(ad.getCallToAction());
        callToAction.setVisibility(ad.getCallToAction() == null ? View.GONE : View.VISIBLE);
        adView.setCallToActionView(callToAction);
        adView.setNativeAd(ad);
        return adView;
    }

    private void loadInterstitialAd() {
        if (interstitialLoading || interstitialAd != null || activity.isFinishing()
            || activity.isDestroyed() || interstitialsShown >= MAX_INTERSTITIALS_PER_SESSION) return;
        interstitialLoading = true;
        InterstitialAd.load(
            activity,
            BuildConfig.ADMOB_INTERSTITIAL_ID,
            new AdRequest.Builder().build(),
            new InterstitialAdLoadCallback() {
                @Override
                public void onAdLoaded(InterstitialAd ad) {
                    interstitialLoading = false;
                    if (activity.isFinishing() || activity.isDestroyed()) return;
                    interstitialAd = ad;
                }

                @Override
                public void onAdFailedToLoad(LoadAdError error) {
                    interstitialLoading = false;
                    interstitialAd = null;
                }
            }
        );
    }

    private void showInterstitialIfReady() {
        if (activity.isFinishing() || activity.isDestroyed()
            || interstitialsShown >= MAX_INTERSTITIALS_PER_SESSION) return;
        handler.postDelayed(interstitialOpportunity, INTERSTITIAL_INTERVAL_MS);
        if (!activityResumed || !contentReady || (exitDialog != null && exitDialog.isShowing())) return;
        if (interstitialAd == null) {
            loadInterstitialAd();
            return;
        }
        InterstitialAd ad = interstitialAd;
        interstitialAd = null;
        ad.setFullScreenContentCallback(new FullScreenContentCallback() {
            @Override
            public void onAdShowedFullScreenContent() {
                interstitialsShown++;
            }

            @Override
            public void onAdDismissedFullScreenContent() {
                loadInterstitialAd();
            }

            @Override
            public void onAdFailedToShowFullScreenContent(com.google.android.gms.ads.AdError error) {
                loadInterstitialAd();
            }
        });
        ad.show(activity);
    }

    private void loadExitMrecAd() {
        if (exitMrecAd != null || activity.isFinishing() || activity.isDestroyed()) return;
        AdView adView = new AdView(activity);
        adView.setAdSize(AdSize.MEDIUM_RECTANGLE);
        adView.setAdUnitId(BuildConfig.ADMOB_MREC_ID);
        adView.setAdListener(new AdListener() {
            @Override
            public void onAdLoaded() {
                if (activity.isFinishing() || activity.isDestroyed() || exitMrecAd != adView) {
                    adView.destroy();
                    return;
                }
                exitMrecLoaded = true;
            }

            @Override
            public void onAdFailedToLoad(LoadAdError error) {
                if (exitMrecAd == adView) {
                    exitMrecLoaded = false;
                    exitMrecAd = null;
                }
                adView.destroy();
            }
        });
        exitMrecAd = adView;
        exitMrecLoaded = false;
        adView.loadAd(new AdRequest.Builder().build());
    }

    private void destroyExitMrecAd() {
        exitMrecLoaded = false;
        if (exitMrecAd == null) return;
        ViewParent parent = exitMrecAd.getParent();
        if (parent instanceof ViewGroup) ((ViewGroup) parent).removeView(exitMrecAd);
        exitMrecAd.destroy();
        exitMrecAd = null;
    }

    private View createExitDialogContent() {
        int spacing = Math.round(16 * activity.getResources().getDisplayMetrics().density);
        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(spacing, 0, spacing, 0);
        TextView message = new TextView(activity);
        message.setText(R.string.exit_message);
        message.setTextColor(Color.DKGRAY);
        message.setTextSize(16);
        content.addView(message, new LinearLayout.LayoutParams(-1, -2));
        if (exitMrecLoaded && exitMrecAd != null) {
            TextView attribution = new TextView(activity);
            attribution.setText(R.string.ad_attribution);
            attribution.setTextColor(Color.GRAY);
            attribution.setTextSize(11);
            LinearLayout.LayoutParams attributionParams = new LinearLayout.LayoutParams(-2, -2);
            attributionParams.topMargin = spacing;
            attributionParams.gravity = Gravity.CENTER_HORIZONTAL;
            content.addView(attribution, attributionParams);
            ViewParent parent = exitMrecAd.getParent();
            if (parent instanceof ViewGroup) ((ViewGroup) parent).removeView(exitMrecAd);
            LinearLayout.LayoutParams adParams = new LinearLayout.LayoutParams(
                Math.round(300 * activity.getResources().getDisplayMetrics().density),
                Math.round(250 * activity.getResources().getDisplayMetrics().density)
            );
            adParams.gravity = Gravity.CENTER_HORIZONTAL;
            content.addView(exitMrecAd, adParams);
        }
        return content;
    }

    void showExitDialog() {
        if (exitDialog != null && exitDialog.isShowing()) return;
        exitDialog = new AlertDialog.Builder(activity)
            .setTitle(R.string.exit_title)
            .setView(createExitDialogContent())
            .setNegativeButton(R.string.exit_continue, null)
            .setPositiveButton(R.string.exit_confirm, (dialog, which) -> activity.finish())
            .create();
        exitDialog.setOnDismissListener(dialog -> {
            exitDialog = null;
            destroyExitMrecAd();
            if (!activity.isFinishing() && !activity.isDestroyed() && initialized.get()) loadExitMrecAd();
        });
        exitDialog.show();
    }

    void setContentReady(boolean ready) {
        contentReady = ready;
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
        nativeHost.setVisibility(View.GONE);
        privacyButton.setVisibility(View.GONE);
    }

    void pause() {
        activityResumed = false;
        if (exitMrecAd != null) exitMrecAd.pause();
    }

    void resume() {
        activityResumed = true;
        if (exitMrecAd != null) exitMrecAd.resume();
    }

    void destroy() {
        handler.removeCallbacks(interstitialOpportunity);
        if (exitDialog != null) exitDialog.dismiss();
        exitDialog = null;
        if (nativeAd != null) {
            nativeAd.destroy();
            nativeAd = null;
        }
        interstitialAd = null;
        destroyExitMrecAd();
        nativeHost.removeAllViews();
    }
}
