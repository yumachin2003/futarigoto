import React, { useState, useEffect } from "react";

export default function AddToHomeScreenPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [platform, setPlatform] = useState("ios-safari");
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const urlParams = new URLSearchParams(window.location.search);
    const forceShow = urlParams.get("pwa_prompt") === "1" || urlParams.get("debug_pwa") === "true";
    const forceBypass = urlParams.get("bypass_pwa") === "1" || urlParams.get("bypass") === "1";

    if (forceBypass) {
      setShowPrompt(false);
      return;
    }

    // 1. スタンドアロン判定 (PWAホーム画面アイコンから起動されたか)
    const isStandalone =
      window.navigator.standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches ||
      document.referrer.includes("android-app://");

    // 2. モバイル端末判定
    const ua = window.navigator.userAgent || "";
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    const isMobile = isIOS || isAndroid || /Mobi|Tablet/i.test(ua);

    // アプリ内ブラウザ（LINE, Instagram, Twitter/X, Facebook等）
    const isInAppBrowser = /Line|FBAN|FBAV|Instagram|Twitter|MicroMessenger/i.test(ua);

    if (forceShow || (isMobile && !isStandalone)) {
      setShowPrompt(true);
      if (isInAppBrowser) {
        setPlatform("in-app");
      } else if (isIOS) {
        setPlatform("ios-safari");
      } else {
        setPlatform("android");
      }
    }

    // Android Chrome 等の PWA インストールプロンプト用イベント
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setPlatform("android-can-install");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShowPrompt(false);
    }
    setDeferredPrompt(null);
  };

  if (!showPrompt) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: "100%",
        height: "100dvh",
        backgroundColor: "#1c1c1e",
        color: "#ffffff",
        zIndex: 999999,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        alignItems: "center",
        boxSizing: "border-box",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 40px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)",
        paddingLeft: "24px",
        paddingRight: "24px",
        overflow: "hidden",
        userSelect: "none",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif',
      }}
    >
      <style>{`
        @keyframes bounceDown {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(8px);
          }
        }
        .a2hs-bounce {
          animation: bounceDown 1.6s ease-in-out infinite;
        }
      `}</style>

      {/* 最上部（LINEなどのアプリ内ブラウザ風バー、またはクリーンな余白） */}
      <div style={{ height: "10px" }} />

      {/* 中央：アプリアイコンとアプリ名 */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          marginTop: "-4vh",
        }}
      >
        <div
          style={{
            width: "92px",
            height: "92px",
            borderRadius: "22px",
            overflow: "hidden",
            boxShadow: "0 14px 36px rgba(0, 0, 0, 0.55)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            backgroundColor: "#2a2a2c",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img
            src="/apple-touch-icon-v3.png"
            alt="Futarigoto"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>

        <h1
          style={{
            marginTop: "16px",
            marginBottom: "6px",
            fontSize: "20px",
            fontWeight: "700",
            letterSpacing: "0.02em",
            color: "#ffffff",
          }}
        >
          Futarigoto
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "13px",
            color: "#8e8e93",
            fontWeight: "500",
          }}
        >
          二人の立替・割り勘管理
        </p>
      </div>

      {/* 下部：吹き出しガイド */}
      <div
        className="a2hs-bounce"
        style={{
          width: "100%",
          maxWidth: "340px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          marginBottom: "4px",
        }}
      >
        {/* 吹き出しボックス */}
        <div
          style={{
            width: "100%",
            backgroundColor: "#2c2c2e",
            borderRadius: "14px",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
            padding: "18px 20px",
            boxSizing: "border-box",
            textAlign: "center",
          }}
        >
          {platform === "ios-safari" && (
            <>
              {/* 共有アイコン + をタップして */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "15px",
                  fontWeight: "600",
                  color: "#ffffff",
                  gap: "6px",
                  marginBottom: "4px",
                }}
              >
                {/* iOS Share Icon */}
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#0A84FF"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ display: "inline-block" }}
                >
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
                <span>をタップして</span>
              </div>

              {/* [ホーム画面に追加]を選択してください */}
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: "700",
                  color: "#ffffff",
                  marginBottom: "10px",
                  letterSpacing: "0.01em",
                }}
              >
                [ホーム画面に追加]を選択してください
              </div>

              {/* 補足文 */}
              <p
                style={{
                  fontSize: "12px",
                  color: "#a1a1aa",
                  lineHeight: "1.55",
                  margin: 0,
                }}
              >
                ホーム画面に追加して起動すると、
                <br />
                全画面アプリとして通知も快適にご利用いただけます。
              </p>
            </>
          )}

          {platform === "in-app" && (
            <>
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: "700",
                  color: "#ffffff",
                  marginBottom: "6px",
                }}
              >
                Safari（ブラウザ）で開いてください
              </div>
              <p
                style={{
                  fontSize: "13px",
                  color: "#a1a1aa",
                  lineHeight: "1.6",
                  margin: 0,
                }}
              >
                右上のメニュー「…」または共有ボタンから
                <br />
                <span style={{ color: "#ffffff", fontWeight: "600" }}>「Safariで開く」</span>
                を選択後、
                <br />
                ホーム画面に追加してください。
              </p>
            </>
          )}

          {platform === "android-can-install" && (
            <>
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: "700",
                  color: "#ffffff",
                  marginBottom: "8px",
                }}
              >
                ホーム画面に追加してください
              </div>
              <button
                onClick={handleInstallClick}
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  backgroundColor: "#0A84FF",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "10px",
                  fontSize: "15px",
                  fontWeight: "600",
                  cursor: "pointer",
                  marginTop: "6px",
                  marginBottom: "8px",
                  boxShadow: "0 4px 12px rgba(10, 132, 255, 0.4)",
                }}
              >
                アプリをホーム画面に追加
              </button>
              <p
                style={{
                  fontSize: "12px",
                  color: "#a1a1aa",
                  lineHeight: "1.5",
                  margin: 0,
                }}
              >
                ホーム画面から起動すると快適にご利用いただけます。
              </p>
            </>
          )}

          {platform === "android" && (
            <>
              <div
                style={{
                  fontSize: "15px",
                  fontWeight: "700",
                  color: "#ffffff",
                  marginBottom: "4px",
                }}
              >
                右上のメニュー「︙」をタップ
              </div>
              <div
                style={{
                  fontSize: "15px",
                  fontWeight: "700",
                  color: "#ffffff",
                  marginBottom: "8px",
                }}
              >
                [ホーム画面に追加]を選択してください
              </div>
              <p
                style={{
                  fontSize: "12px",
                  color: "#a1a1aa",
                  lineHeight: "1.55",
                  margin: 0,
                }}
              >
                ホーム画面に追加して起動すると、
                <br />
                全画面アプリとして通知も快適にご利用いただけます。
              </p>
            </>
          )}
        </div>

        {/* 吹き出し下の白い逆三角形ポインター（iOS Safariの共有ボタンを指す） */}
        {platform === "ios-safari" && (
          <div
            style={{
              width: 0,
              height: 0,
              borderLeft: "13px solid transparent",
              borderRight: "13px solid transparent",
              borderTop: "16px solid #ffffff",
              marginTop: "-1px",
              filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.5))",
            }}
          />
        )}
      </div>
    </div>
  );
}
