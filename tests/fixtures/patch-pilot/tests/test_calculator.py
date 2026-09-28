import unittest

from calculator import add


class AdditionTests(unittest.TestCase):
    def test_positive_numbers(self):
        self.assertEqual(add(3, 5), 8)

    def test_zero(self):
        self.assertEqual(add(0, 7), 7)

    def test_negative_number(self):
        self.assertEqual(add(-2, 5), 3)


if __name__ == "__main__":
    unittest.main()
