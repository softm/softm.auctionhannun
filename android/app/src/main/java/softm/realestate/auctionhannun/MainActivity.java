package softm.realestate.auctionhannun;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JsPromptResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String HOME = "https://auctionhannun.designboard.net/?app=1.0.2";
    private static final String TRUSTED_HOST = "auctionhannun.designboard.net";
    private static final String TRUSTED_PATH = "/";

    private WebView web;
    private ProgressBar progress;
    private LinearLayout error;
    private AdMobController ads;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xfff7f9fc);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(
                insets.getSystemWindowInsetLeft(),
                insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(),
                insets.getSystemWindowInsetBottom()
            );
            return insets;
        });

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(0xff0f766e));
        root.addView(progress, new LinearLayout.LayoutParams(-1, 6));

        error = new LinearLayout(this);
        error.setOrientation(LinearLayout.VERTICAL);
        error.setPadding(48, 72, 48, 48);

        TextView message = new TextView(this);
        message.setText("경매한눈에 연결할 수 없습니다.\n인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
        message.setTextSize(18);
        message.setTextColor(Color.DKGRAY);
        error.addView(message);

        Button retry = new Button(this);
        retry.setText("다시 시도");
        retry.setOnClickListener(view -> retry());
        error.addView(retry);
        root.addView(error);
        error.setVisibility(View.GONE);

        web = new WebView(this);
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));

        Button privacyOptions = new Button(this);
        privacyOptions.setText(R.string.privacy_options);
        privacyOptions.setVisibility(View.GONE);
        root.addView(privacyOptions, new LinearLayout.LayoutParams(-1, -2));

        FrameLayout bannerHost = new FrameLayout(this);
        bannerHost.setVisibility(View.GONE);
        bannerHost.setContentDescription(getString(R.string.ad_label));
        root.addView(bannerHost, new LinearLayout.LayoutParams(-1, -2));
        setContentView(root);

        configureWebView();
        ads = new AdMobController(this, bannerHost, privacyOptions);
        ads.start();
        if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString()
            + " AuctionhannunAndroid/2"
            + (BuildConfig.ADMOB_ENABLED ? " AdMobNative/1" : ""));

        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return route(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return route(Uri.parse(url));
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                error.setVisibility(View.GONE);
                web.setVisibility(View.VISIBLE);
                progress.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                if (!trusted(Uri.parse(url))) return;
                view.evaluateJavascript(
                    "(function(){if(navigator.share)return;" +
                    "Object.defineProperty(navigator,'share',{configurable:true,value:function(data){" +
                    "return new Promise(function(resolve,reject){" +
                    "if(!data||!data.url){reject(new TypeError('공유 링크가 없습니다.'));return;}" +
                    "var result=window.prompt('SOFTM_SHARE_LINK',JSON.stringify({title:String(data.title||''),url:String(data.url)}));" +
                    "if(result==='shared')resolve();else reject(new Error('공유창을 열지 못했습니다.'));});}});})()",
                    null
                );
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError failure) {
                if (request.isForMainFrame()) showError();
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) showError();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
                if (!"SOFTM_SHARE_LINK".equals(message)) return super.onJsPrompt(view, url, message, defaultValue, result);
                if (!trusted(Uri.parse(url)) || view.getUrl() == null || !trusted(Uri.parse(view.getUrl()))) {
                    result.cancel();
                    return true;
                }
                try {
                    JSONObject data = new JSONObject(defaultValue);
                    Uri link = Uri.parse(data.getString("url"));
                    if (!trusted(link)) {
                        result.cancel();
                        return true;
                    }
                    Intent share = new Intent(Intent.ACTION_SEND);
                    share.setType("text/plain");
                    share.putExtra(Intent.EXTRA_TEXT, link.toString());
                    share.putExtra(Intent.EXTRA_SUBJECT, data.optString("title", "경매한눈"));
                    startActivity(Intent.createChooser(share, "링크 공유"));
                    result.confirm("shared");
                } catch (Exception failure) {
                    result.cancel();
                    Toast.makeText(MainActivity.this, "공유창을 열지 못했습니다.", Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                if (value == 100) progress.setVisibility(View.GONE);
            }
        });
    }

    private boolean trusted(Uri uri) {
        String path = uri.getPath() == null ? "/" : uri.getPath();
        return "https".equals(uri.getScheme())
            && TRUSTED_HOST.equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443)
            && path.startsWith(TRUSTED_PATH);
    }

    private boolean route(Uri uri) {
        if (trusted(uri)) return false;
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme) && !"mailto".equals(scheme) && !"tel".equals(scheme)) {
            Toast.makeText(this, "지원하지 않는 링크입니다.", Toast.LENGTH_SHORT).show();
            return true;
        }
        Intent intent = "tel".equals(scheme)
            ? new Intent(Intent.ACTION_DIAL, uri)
            : new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE);
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException failure) {
            Toast.makeText(this, "연결할 앱이 설치되어 있지 않습니다.", Toast.LENGTH_LONG).show();
        }
        return true;
    }

    private void showError() {
        error.setVisibility(View.VISIBLE);
        web.setVisibility(View.GONE);
        progress.setVisibility(View.GONE);
    }

    private void retry() {
        String url = web.getUrl();
        web.loadUrl(url != null && trusted(Uri.parse(url)) ? url : HOME);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        web.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override
    protected void onPause() {
        if (ads != null) ads.pause();
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        if (ads != null) ads.resume();
    }

    @Override
    protected void onDestroy() {
        if (ads != null) ads.destroy();
        web.destroy();
        super.onDestroy();
    }
}
