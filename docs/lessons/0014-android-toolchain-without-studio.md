# 0014 装安卓工具链不需要 Android Studio

## 现象

要给项目加安卓宿主，第一反应是「装 Android Studio」——官方文档、各种教程
都从这里开始，体积 8–10 GB，还要走 GUI 安装器。

实际只需要三样东西，合计 **727 MB**：

| 组件 | 大小 | 来源 |
| --- | --- | --- |
| JDK 21 (Temurin) | 196 MB | 镜像站 |
| Android cmdline-tools | 147 MB | `dl.google.com` |
| platform-tools + platforms;android-35 + build-tools;35.0.0 | ~380 MB | `sdkmanager` 拉取 |

装完 `java -version`、`adb version`、`sdkmanager --version` 全部可用，
`gradle` 由项目自带的 wrapper 提供，不需要单独装。

## 根因

**Android Studio 是 IDE，不是构建依赖。**

构建一个 APK 真正需要的是：JDK（跑 Gradle）、Android SDK（编译目标平台）、
build-tools（aapt2 / d8 / zipalign）。这三样都能通过命令行工具装，
Android Studio 只是把它们打包进一个带 GUI 的安装器里。

对 AI 协作场景尤其重要：GUI 安装器需要人点「下一步」，
而命令行安装可以脚本化、可复现、可写进文档。

## 结论

**装安卓工具链用 cmdline-tools，不要装 Android Studio。**

判定方式：**问自己「我需要的是 IDE 还是构建能力」。**
只需要构建 / 跑测试 / 出 APK 时，cmdline-tools 足够；
只有需要可视化布局编辑器、Profiler、模拟器管理界面时才值得装 IDE。

本仓库的落点：工具链装在 `D:\tools\android`，环境变量由
`D:\tools\android\env.ps1` 提供（dot-source 使用）。
不写进系统 PATH —— 卸载就是删目录，也不会污染其他项目。

## 反例

不要因为「官方推荐 Android Studio」就默认它是唯一路径：

```powershell
# 错：下载 8-10 GB 的 GUI 安装器，还需要人工点击
# https://developer.android.com/studio

# 对：命令行工具，可脚本化
curl -L -o cmdline-tools.zip https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip
sdkmanager --sdk_root=$sdk "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

也不要把 `cmdline-tools` 直接解压到 `sdk/cmdline-tools/` 下——
`sdkmanager` 要求它位于 `sdk/cmdline-tools/latest/`，
少一层 `latest` 会报「Could not determine SDK root」。
