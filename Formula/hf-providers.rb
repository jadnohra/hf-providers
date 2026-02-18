class HfProviders < Formula
  desc "Find inference providers for Hugging Face models, compare them, get code snippets"
  homepage "https://github.com/jadnohra/hf-providers"
  version "0.1.2"
  license any_of: ["MIT", "Apache-2.0"]

  on_macos do
    on_arm do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-aarch64-apple-darwin.tar.gz"
      sha256 "57ec40d13c68e183e4bc4f2b0caa29f9c6b58d436fe7bb6d5612eefb5b99e8ec"
    end
    on_intel do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-x86_64-apple-darwin.tar.gz"
      sha256 "10d2d49bfe5935ffa8d25f08ce565024835b3d9d6b8cd3abba887f559b5d41c1"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "f50d5cddce0cda61240c66bd8a7af2109c29594a3ec41dbe179189cc2530ab1c"
    end
  end

  def install
    bin.install "hf-providers"
  end

  test do
    assert_match "hf-providers", shell_output("#{bin}/hf-providers --version")
  end
end
