import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("restore_checkpoint", Path(__file__).with_name("restore-postcapture-publication-checkpoint.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PublicationCheckpointTests(unittest.TestCase):
    def test_exact_physical_restore_and_unsafe_member_rejection(self):
        for name, kind in (("./publication.json", tarfile.REGTYPE), ("../escape", tarfile.REGTYPE), ("/absolute", tarfile.REGTYPE), ("nested/link", tarfile.SYMTYPE), ("nested/hardlink", tarfile.LNKTYPE), ("C:/drive", tarfile.REGTYPE)):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                stream = io.BytesIO()
                with tarfile.open(fileobj=stream, mode="w") as archive:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    if kind == tarfile.REGTYPE:
                        member.size = 5
                        archive.addfile(member, io.BytesIO(b"exact"))
                    else:
                        member.linkname = "../escape"
                        archive.addfile(member)
                zipped = root / "pages.zip"
                with zipfile.ZipFile(zipped, "w") as archive:
                    archive.writestr("artifact.tar", stream.getvalue())
                if name == "./publication.json":
                    module.restore(zipped, root / "restored")
                    self.assertEqual((root / "restored/publication.json").read_bytes(), b"exact")
                else:
                    with self.assertRaises(ValueError):
                        module.restore(zipped, root / "restored")
                self.assertFalse((root / "escape").exists())

    def test_wrong_zip_member_is_not_a_publication_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with zipfile.ZipFile(root / "wrong.zip", "w") as archive:
                archive.writestr("candidate.tar", b"not pages")
            with self.assertRaisesRegex(ValueError, "Unexpected checkpoint ZIP"):
                module.restore(root / "wrong.zip", root / "restored")


if __name__ == "__main__":
    unittest.main()
