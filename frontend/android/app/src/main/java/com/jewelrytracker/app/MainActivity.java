package com.jewelrytracker.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Switch from Launch theme (full-screen splash image) to normal app theme.
        // Must be called BEFORE super.onCreate() for the window to pick up the new theme.
        setTheme(R.style.AppTheme_NoActionBar);
        super.onCreate(savedInstanceState);
    }
}
