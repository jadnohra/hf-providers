class HfProviders < Formula
  desc "Find inference providers for Hugging Face models, compare them, get code snippets"
  homepage "https://github.com/jadnohra/hf-providers"
  version "0.1.5"
  license any_of: ["MIT", "Apache-2.0"]

  on_macos do
    on_arm do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-aarch64-apple-darwin.tar.gz"
      sha256 "a90ee19d86bf52593a9d9a33a7d8ff493106786bd2df5e2c6159be4965214e2c"
    end
    on_intel do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-x86_64-apple-darwin.tar.gz"
      sha256 "cb9700b396c8178b8d9d4882e7f525f8dfac5ff33678ab0e553d7aa5cbe8486d"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "e5941a3f0d5c9bbcc8822c74850f09032aaf94ceb8fff240595c1612958afd8b"
    end
  end

  def install
    bin.install "hf-providers"
  end

  test do
    assert_match "hf-providers", shell_output("#{bin}/hf-providers --version")
  end
end
