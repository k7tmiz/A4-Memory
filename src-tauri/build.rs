fn main() {
    #[cfg(all(target_os = "windows", not(target_os = "android")))]
    {
        println!("cargo:rustc-link-lib=advapi32");
        println!("cargo:rustc-link-lib=ole32");
        println!("cargo:rustc-link-lib=user32");
        println!("cargo:rustc-link-lib=shell32");
        println!("cargo:rustc-link-lib=tdh");
    }
    tauri_build::build()
}
