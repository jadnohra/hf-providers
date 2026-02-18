class HfProviders < Formula
  desc "Real-time inference provider comparison for Hugging Face models"
  homepage "https://github.com/jadnohra/hf-providers"
  version "0.1.1"
  license any_of: ["MIT", "Apache-2.0"]

  on_macos do
    on_arm do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-aarch64-apple-darwin.tar.gz"
      sha256 "9405eb2d02b80cfc939caa9facc5077be7685cf47ffff233a31902d8a9355f66"
    end
    on_intel do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-x86_64-apple-darwin.tar.gz"
      sha256 "614c229b635acb5cfd9d20156dde9f0b294ce82362606c096dbfe992bf52449b"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "768582291e06f309b22b2abec080eb439e60380bc8ed8cab93b89102842c004c"
    end
  end

  def install
    bin.install "hf-providers"
  end

  test do
    assert_match "hf-providers", shell_output("#{bin}/hf-providers --version")
  end
end
