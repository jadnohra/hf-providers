class HfProviders < Formula
  desc "Inference provider comparison for Hugging Face models"
  homepage "https://github.com/jadnohra/hf-providers"
  version "0.1.0"
  license any_of: ["MIT", "Apache-2.0"]

  on_macos do
    on_arm do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-aarch64-apple-darwin.tar.gz"
      sha256 "dd5e72869321c69bd4f8c991e071eb20bf6e1785c20ce4a71f452c687b11d864"
    end
    on_intel do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-x86_64-apple-darwin.tar.gz"
      sha256 "b82832b18ec609cdd5394aa26b3c85913dd330a173fe0818a4a392737796513d"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "c5f5d53975e2026995607bf120789ff437dd13aa34f3a86bafe0b93df5f3f55e"
    end
  end

  def install
    bin.install "hf-providers"
  end

  test do
    assert_match "hf-providers", shell_output("#{bin}/hf-providers --version")
  end
end
