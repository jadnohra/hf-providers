class HfProviders < Formula
  desc "Find out how to run any Hugging Face model — providers, pricing, status"
  homepage "https://github.com/jadnohra/hf-providers"
  version "0.1.0"
  license any_of: ["MIT", "Apache-2.0"]

  on_macos do
    on_arm do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-aarch64-apple-darwin.tar.gz"
      # sha256 "PLACEHOLDER"  # fill after first release
    end
    on_intel do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-x86_64-apple-darwin.tar.gz"
      # sha256 "PLACEHOLDER"  # fill after first release
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-x86_64-unknown-linux-gnu.tar.gz"
      # sha256 "PLACEHOLDER"  # fill after first release
    end
  end

  def install
    bin.install "hf-providers"
  end

  test do
    assert_match "hf-providers", shell_output("#{bin}/hf-providers --version")
  end
end
