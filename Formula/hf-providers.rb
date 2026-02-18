class HfProviders < Formula
  desc "Find inference providers for Hugging Face models, compare them, get code snippets"
  homepage "https://github.com/jadnohra/hf-providers"
  version "0.1.3"
  license any_of: ["MIT", "Apache-2.0"]

  on_macos do
    on_arm do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-aarch64-apple-darwin.tar.gz"
      sha256 "44b53fb95eb485e9572231e77ebbf3d57bd9360b270db8afbb44ba0466651798"
    end
    on_intel do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-x86_64-apple-darwin.tar.gz"
      sha256 "31c799bfe6af4423339d2dca01ade1accda1167dcf9682f1ca5e7f96bd5a461e"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/jadnohra/hf-providers/releases/download/v#{version}/hf-providers-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "c7ac88b1949a68ce182cb09dd8be037669bc0d53ccb37ab82a8ca68c1fdb6012"
    end
  end

  def install
    bin.install "hf-providers"
  end

  test do
    assert_match "hf-providers", shell_output("#{bin}/hf-providers --version")
  end
end
