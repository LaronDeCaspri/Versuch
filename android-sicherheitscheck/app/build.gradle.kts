plugins {
    id("com.android.application")
}

android {
    namespace = "app.sicherheitscheck"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.sicherheitscheck"
        minSdk = 28
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Zum privaten Installieren reicht die Debug-Signatur.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        checkReleaseBuilds = false
    }
}
